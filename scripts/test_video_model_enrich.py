import copy
import base64
import importlib.util
import io
import json
import os
import tempfile
import unittest
import urllib.error
from unittest import mock
from pathlib import Path

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('video_model_enrich',HERE/'video_model_enrich.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
ROOT=HERE.parent
SHOTS=json.loads((ROOT/'examples/scene-demo-shots.json').read_text());SCENE=json.loads((ROOT/'examples/scene-demo.json').read_text())


def config():
    return {m.PREFIX+k:v for k,v in {'INPUT_MODE':'inline','API_BASE_URL':'https://provider.example/v1','MODEL':'vendor/test-model','PROTOCOL':'gemini_generate_content','REQUEST_PATH':'/v1beta/models/{model}:generateContent','AUTH_HEADER':'Authorization','AUTH_SCHEME':'Bearer','API_KEY':'test-key-not-for-real-use','MAX_REQUEST_BYTES':'1000000','MAX_OUTPUT_TOKENS':'1500','TIMEOUT_SECONDS':'10'}.items()}


def url_config():
    c=config();c.pop(m.PREFIX+'INPUT_MODE')  # Exercise the actual default, not an explicitly selected mode.
    c.update({m.PREFIX+'UPLOAD_API_URL':'https://upload.example/media/binary',m.PREFIX+'MAX_UPLOAD_BYTES':'1000000'})
    return c


MEDIA_URI='https://media.example/video.mp4?signature=private-test-signature'


def upload_response(code=0, **overrides):
    return {'code':code,'message':'success','data':dict({'download_url':MEDIA_URI,'type':'video'},**overrides)}


def model_response():
    text=json.dumps(analysis(),ensure_ascii=False)
    return {'candidates':[{'finishReason':'STOP','content':{'parts':[{'text':text[i:i+7]} for i in range(0,len(text),7)]}}],
            'usageMetadata':{'promptTokensDetails':[{'modality':'VIDEO','tokenCount':100}]}}


class FakeOpener:
    def __init__(self,*responses):self.responses=list(responses);self.requests=[]
    def open(self,request,timeout):
        self.requests.append(request)
        item=self.responses.pop(0)
        if isinstance(item,Exception):raise item
        return io.BytesIO(json.dumps(item).encode())


def analysis():
    return {'media_observation':{'video_observed':True,'audio_observed':False,'summary':'合成测试，不是真实影片'},'shots':[{
        'shot_id':s['id'],'observations':[{'at_s':s['start']+.5,'description':'合成画面线索，不是真实拍摄记录'}],
        'lens_estimate':{'status':'inferred','confidence':'low','summary':'视野偏普通的假设','view_category':'normal','horizontal_fov_deg_range':None,'equivalent_focal_mm_range':None,'equivalence_standard':'none','assumptions':[],'limitations':['没有相机资料，不保证唯一。']},
        'camera_movement':{'summary':'相机与人物分开判断','confidence':'low','alternatives':[]},'lighting_estimate':{'summary':'来光只是推演','confidence':'low','alternatives':[]}
    } for s in SHOTS['shots']],'overall_limitations':['非实测']}


class TestNativeVideo(unittest.TestCase):
    def test_url_preserves_vendor_slash(self):
        self.assertEqual(m.request_url(config()),'https://provider.example/v1beta/models/vendor/test-model:generateContent')
    def test_foreign_host_refused(self):
        c=config();c[m.PREFIX+'REQUEST_PATH']='https://elsewhere.example/{model}';self.assertRaises(ValueError,m.request_url,c)
    def test_query_refused(self):
        c=config();c[m.PREFIX+'REQUEST_PATH']='/{model}?key=bad';self.assertRaises(ValueError,m.request_url,c)
    def test_http_refused(self):
        c=config();c[m.PREFIX+'API_BASE_URL']='http://provider.example';self.assertRaises(ValueError,m.request_url,c)
    def test_model_traversal_refused(self):
        c=config();c[m.PREFIX+'MODEL']='../escape';self.assertRaises(ValueError,m.request_url,c)
    def test_config_permissions(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t)/'x.env';p.write_text('X=Y');p.chmod(0o644);self.assertRaises(ValueError,m.load_config,p,{})
    def test_external_config_not_source_defaults(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t)/'x.env';p.write_text(''.join(k+'='+v+'\n' for k,v in config().items()));p.chmod(0o600);self.assertEqual(m.load_config(p,{})[m.PREFIX+'MODEL'],'vendor/test-model')
    def test_protocol_cannot_silently_fallback(self):
        c=config();c[m.PREFIX+'PROTOCOL']='frame-only'
        with tempfile.TemporaryDirectory() as t:
            p=Path(t)/'x.env';p.write_text(''.join(k+'='+v+'\n' for k,v in c.items()));p.chmod(0o600);self.assertRaises(ValueError,m.load_config,p,{})
    def test_body_really_contains_single_native_video(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t)/'v.mp4';p.write_bytes(b'fake-media-test');c=config();c[m.PREFIX+'VIDEO_FPS']='4';body,prov=m.build_request(c,p,SHOTS);d=json.loads(body);parts=d['contents'][0]['parts'];self.assertEqual(len(parts),2);self.assertEqual(parts[0]['inlineData']['mimeType'],'video/mp4');self.assertEqual(parts[0]['videoMetadata']['fps'],4);self.assertNotIn(c[m.PREFIX+'API_KEY'],body.decode());self.assertEqual(prov['input_mode'],'native_video_inline')
    def test_upload_budget_fails_before_network(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t)/'v.mp4';p.write_bytes(b'fake');c=config();c[m.PREFIX+'MAX_REQUEST_BYTES']='1';self.assertRaises(ValueError,m.build_request,c,p,SHOTS)
    def test_invalid_media_not_auto_transcoded(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t)/'v.xyz';p.write_bytes(b'fake');self.assertRaises(ValueError,m.build_request,config(),p,SHOTS)
    def test_extract_ignores_thought_parts(self):
        r={'candidates':[{'content':{'parts':[{'thought':True,'text':'not output'},{'text':'{}'}]}}]};self.assertEqual(m.answer_text(r),'{}')
    def test_empty_http_success_not_analysis_success(self):
        self.assertRaises(ValueError,m.answer_text,{'candidates':[]})
    def test_valid_analysis(self):
        self.assertEqual(len(m.validate_analysis(analysis(),SHOTS)['shots']),len(SHOTS['shots']))
    def test_missing_shot_refused(self):
        d=analysis();d['shots'].pop();self.assertRaises(ValueError,m.validate_analysis,d,SHOTS)
    def test_duplicate_shot_refused(self):
        d=analysis();d['shots'].append(copy.deepcopy(d['shots'][0]));self.assertRaises(ValueError,m.validate_analysis,d,SHOTS)
    def test_evidence_time_refused(self):
        d=analysis();d['shots'][0]['observations'][0]['at_s']=SHOTS['shots'][0]['end'];self.assertRaises(ValueError,m.validate_analysis,d,SHOTS)
    def test_claim_cannot_be_promoted_to_observed_focal(self):
        d=analysis();d['shots'][0]['lens_estimate']['status']='observed';self.assertRaises(ValueError,m.validate_analysis,d,SHOTS)
    def test_range_requires_assumptions(self):
        d=analysis();d['shots'][0]['lens_estimate']['equivalent_focal_mm_range']=[25,40];self.assertRaises(ValueError,m.validate_analysis,d,SHOTS)
    def test_focal_range_requires_equivalence_standard(self):
        d=analysis();l=d['shots'][0]['lens_estimate'];l.update(equivalent_focal_mm_range=[25,40],assumptions=['假设某个感光面']);self.assertRaises(ValueError,m.validate_analysis,d,SHOTS)
    def test_high_fov_refused(self):
        d=analysis();l=d['shots'][0]['lens_estimate'];l.update(horizontal_fov_deg_range=[100,190],assumptions=['测试']);self.assertRaises(ValueError,m.validate_analysis,d,SHOTS)
    def test_unknown_confidence_consistent(self):
        d=analysis();d['shots'][0]['lens_estimate']['status']='unknown';self.assertRaises(ValueError,m.validate_analysis,d,SHOTS)
    def test_merge_does_not_change_machine_data_or_camera(self):
        shots=copy.deepcopy(SHOTS);scene=copy.deepcopy(SCENE);before=m.machine_binding(shots);result=m.reviewed_merge(scene,analysis(),shots,{'model':'test','input_mode':'native_video_inline','video_sha256':'test'});self.assertEqual(m.machine_binding(shots),before);self.assertEqual(result['setups'],scene['setups']);self.assertEqual(result['shots'][0]['cameraNote'],scene['shots'][0]['cameraNote']);self.assertFalse(result['shots'][0]['lens']['actual_capture_parameters']['verified']);self.assertNotEqual(result['shots'][0]['lens'],scene['shots'][0]['lens']);self.assertEqual(scene,SCENE)
    def test_duplicate_apply_refused(self):
        a=analysis();prov={'model':'test','input_mode':'native_video_inline','video_sha256':'test'};result=m.reviewed_merge(SCENE,a,SHOTS,prov);self.assertRaises(ValueError,m.reviewed_merge,result,a,SHOTS,prov)
    def test_secret_and_long_data_redaction(self):
        self.assertNotIn('secret',m.redact('echo secret','secret'));self.assertIn('REDACTED',m.redact('A'*200))
    def test_http_error_does_not_leak_secret(self):
        c=config()
        class Opener:
            def open(self,req,timeout):raise urllib.error.HTTPError(req.full_url,401,'bad',{},io.BytesIO(('bad '+c[m.PREFIX+'API_KEY']).encode()))
        with self.assertRaises(RuntimeError) as error:m.remote_call(c,b'{}',Opener())
        self.assertNotIn(c[m.PREFIX+'API_KEY'],str(error.exception))
    def test_no_retry_after_remote_failure(self):
        calls=[]
        class Opener:
            def open(self,req,timeout):calls.append(req);raise TimeoutError('timeout')
        self.assertRaises(TimeoutError,m.remote_call,config(),b'{}',Opener());self.assertEqual(len(calls),1)
    def test_video_probe_rejects_wrong_metadata(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t)/'fake.mp4';p.write_bytes(b'fake')
            result=mock.Mock(stdout=json.dumps({'format':{'duration':'99'},'streams':[{'codec_type':'video','width':1,'height':1}]}))
            with mock.patch.object(m.subprocess,'run',return_value=result):self.assertRaises(ValueError,m.verify_video_against_shots,p,SHOTS,Path(t)/'shots.json')
    def test_video_probe_accepts_matching_metadata(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t)/'fake.mp4';p.write_bytes(b'fake');meta=SHOTS['meta']
            result=mock.Mock(stdout=json.dumps({'format':{'duration':str(meta['durationSeconds'])},'streams':[{'codec_type':'video','width':meta['width'],'height':meta['height']}]}))
            with mock.patch.object(m.subprocess,'run',return_value=result):m.verify_video_against_shots(p,SHOTS,Path(t)/'shots.json')
    def test_request_ledger_stops_duplicate_after_timeout(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);v=root/'v.mp4';v.write_bytes(b'fake');sp=root/'shots.json';cp=root/'scene.json';sp.write_text(json.dumps(SHOTS));cp.write_text(json.dumps(SCENE));out=root/'run'
            args=['--video',str(v),'--shots',str(sp),'--scene',str(cp),'--output-dir',str(out),'--execute']
            with mock.patch.object(m,'load_config',return_value=config()),mock.patch.object(m,'verify_video_against_shots'),mock.patch.object(m,'remote_call',side_effect=TimeoutError('timeout')) as remote:
                self.assertRaises(RuntimeError,m.main,args);self.assertEqual(json.loads((out/'request-status.json').read_text())['state'],'failed');self.assertRaises(ValueError,m.main,args);self.assertEqual(remote.call_count,1)
            self.assertEqual(json.loads(cp.read_text()),SCENE)
    def test_provider_response_preserved_if_model_json_invalid(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);v=root/'v.mp4';v.write_bytes(b'fake');sp=root/'shots.json';cp=root/'scene.json';sp.write_text(json.dumps(SHOTS));cp.write_text(json.dumps(SCENE));out=root/'run'
            response={'candidates':[{'content':{'parts':[{'text':'not json'}]}}]}
            with mock.patch.object(m,'load_config',return_value=config()),mock.patch.object(m,'verify_video_against_shots'),mock.patch.object(m,'remote_call',return_value=response):
                self.assertRaises(RuntimeError,m.main,['--video',str(v),'--shots',str(sp),'--scene',str(cp),'--output-dir',str(out),'--execute'])
            self.assertTrue((out/'provider-response.json').exists());self.assertEqual(json.loads(cp.read_text()),SCENE)
    def test_unreviewed_file_cannot_be_applied(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);v=root/'v.mp4';v.write_bytes(b'fake');sp=root/'shots.json';cp=root/'scene.json';answer=root/'answer.json';sp.write_text(json.dumps(SHOTS));cp.write_text(json.dumps(SCENE));answer.write_text(json.dumps({'analysis':analysis(),'provenance':{'video_sha256':m.sha256_file(v),'timeline_binding':m.machine_binding(SHOTS)}}))
            with mock.patch.object(m,'verify_video_against_shots'):
                self.assertRaises(ValueError,m.main,['--video',str(v),'--shots',str(sp),'--scene',str(cp),'--output-dir',str(root/'run'),'--response-file',str(answer),'--apply'])
            self.assertEqual(json.loads(cp.read_text()),SCENE)
    def test_redirect_refused(self):
        self.assertRaises(ValueError,m.NoRedirect().redirect_request,None,None,307,'redirect',{},'https://elsewhere.example')


class TestUploadedVideo(unittest.TestCase):
    def inputs(self,root):
        v=root/'v.mp4';v.write_bytes(b'opaque original media bytes')
        sp=root/'shots.json';cp=root/'scene.json';sp.write_text(json.dumps(SHOTS));cp.write_text(json.dumps(SCENE))
        return v,cp,['--video',str(v),'--shots',str(sp),'--scene',str(cp),'--output-dir',str(root/'run')]

    def test_default_is_url_and_preflight_has_no_sendable_body(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t)/'v.mp4';p.write_bytes(b'x'*65536);c=url_config();c[m.PREFIX+'MAX_REQUEST_BYTES']='20000'
            body,prov=m.build_request(c,p,SHOTS)
            self.assertIsNone(body);self.assertEqual(prov['input_mode'],'native_video_url')
            self.assertIsNone(prov['request_bytes']);self.assertLess(prov['request_bytes_minimum'],20000)
            self.assertEqual(prov['video_bytes'],65536)

    def test_url_body_contains_file_data_not_base64(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t)/'v.mp4';p.write_bytes(b'opaque');c=url_config();c[m.PREFIX+'VIDEO_FPS']='4'
            body,prov=m.build_request(c,p,SHOTS,MEDIA_URI);parts=json.loads(body)['contents'][0]['parts']
            self.assertEqual(parts[0]['fileData'],{'mimeType':'video/mp4','fileUri':MEDIA_URI})
            self.assertEqual(parts[0]['videoMetadata']['fps'],4)
            self.assertNotIn('inlineData',body.decode());self.assertNotIn(MEDIA_URI,json.dumps(prov))
            self.assertEqual(prov['request_bytes'],len(body))

    def test_missing_upload_configuration_cannot_fallback(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t)/'v.mp4';p.write_bytes(b'fake');c=config();c.pop(m.PREFIX+'INPUT_MODE')
            with self.assertRaisesRegex(ValueError,'UPLOAD_API_URL'):m.build_request(c,p,SHOTS)

    def test_upload_endpoint_requires_explicit_https_without_credentials_or_query(self):
        for value in ['', 'http://upload.example/path','https://u:p@upload.example/x','https://upload.example/x?key=bad','https://upload.example/x#bad','https://upload.example/\npath']:
            with self.subTest(value=value):
                c=url_config();c[m.PREFIX+'UPLOAD_API_URL']=value;self.assertRaises(ValueError,m.upload_url,c)

    def test_input_mode_cannot_guess_other_transports(self):
        c=url_config();c[m.PREFIX+'INPUT_MODE']='frames';self.assertRaises(ValueError,m.input_mode,c)

    def test_bad_media_urls_not_sent(self):
        for uri in ['', 'http://media.example/video.mp4','https://u:p@media.example/x','https://media.example/x#fragment','https://media.example/\nfile']:
            with self.subTest(uri=uri):self.assertRaises(ValueError,m.validate_media_uri,uri)

    def test_upload_budget_and_timeout_preflight(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t)/'v.mp4';p.write_bytes(b'12345')
            for key,value in [('MAX_UPLOAD_BYTES','0'),('MAX_UPLOAD_BYTES','4'),('UPLOAD_TIMEOUT_SECONDS','0')]:
                c=url_config();c[m.PREFIX+key]=value
                with self.subTest(key=key,value=value):self.assertRaises(ValueError,m.build_request,c,p,SHOTS)
            c=url_config();c[m.PREFIX+'MAX_UPLOAD_BYTES']='5';self.assertIsNone(m.build_request(c,p,SHOTS)[0])

    def test_model_prompt_budget_is_checked_before_upload(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);v,cp,args=self.inputs(root);c=url_config();c[m.PREFIX+'MAX_REQUEST_BYTES']='1'
            with mock.patch.object(m,'load_config',return_value=c),mock.patch.object(m,'verify_video_against_shots'),mock.patch.object(m,'upload_video') as upload:
                self.assertRaises(ValueError,m.main,args+['--execute']);upload.assert_not_called()

    def test_actual_url_request_budget_can_stop_after_upload_without_model_call(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);v,cp,args=self.inputs(root);c=url_config()
            minimum=m.build_request(c,v,SHOTS)[1]['request_bytes_minimum'];c[m.PREFIX+'MAX_REQUEST_BYTES']=str(minimum+1)
            opener=FakeOpener(upload_response())
            with mock.patch.object(m,'load_config',return_value=c),mock.patch.object(m,'verify_video_against_shots'),mock.patch.object(m.urllib.request,'build_opener',return_value=opener):
                self.assertRaises(RuntimeError,m.main,args+['--execute'])
            state=json.loads((root/'run/request-status.json').read_text())
            self.assertEqual(state['upload_state'],'succeeded');self.assertEqual(state['analysis_attempts'],0)
            self.assertEqual(len(opener.requests),1);self.assertEqual(json.loads(cp.read_text()),SCENE)

    def test_dry_run_does_not_touch_network_or_create_ledger(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);v,cp,args=self.inputs(root)
            with mock.patch.object(m,'load_config',return_value=url_config()),mock.patch.object(m,'verify_video_against_shots'),mock.patch.object(m,'upload_video') as upload,mock.patch.object(m,'remote_call') as remote,mock.patch('sys.stdout',new_callable=io.StringIO) as output:
                m.main(args);d=json.loads(output.getvalue());self.assertEqual(d['input_mode'],'native_video_url')
                self.assertEqual(d['upload_endpoint'],'https://upload.example/media/binary');upload.assert_not_called();remote.assert_not_called()
            self.assertFalse((root/'run/request-status.json').exists());self.assertEqual(json.loads(cp.read_text()),SCENE)

    def test_upload_preserves_bytes_and_uses_separate_key_and_timeout(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t)/'v.mp4';raw=b'opaque original bytes';p.write_bytes(raw);c=url_config();c[m.PREFIX+'UPLOAD_API_KEY']='upload-only-key';c[m.PREFIX+'UPLOAD_TIMEOUT_SECONDS']='27'
            opener=mock.Mock();opener.open.return_value=io.BytesIO(json.dumps(upload_response(size=str(len(raw)))).encode())
            uri,meta=m.upload_video(c,p,m.sha256_file(p),opener)
            self.assertEqual(uri,MEDIA_URI);self.assertNotIn(MEDIA_URI,json.dumps(meta))
            req=opener.open.call_args.args[0];self.assertIn(raw,req.data);self.assertNotIn(base64.b64encode(raw),req.data)
            self.assertEqual(req.get_header('Authorization'),'Bearer upload-only-key');self.assertIn('multipart/form-data',req.get_header('Content-type'))
            self.assertEqual(opener.open.call_args.kwargs['timeout'],27)

    def test_upload_success_codes(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t)/'v.mp4';p.write_bytes(b'fake')
            for code in [0,200]:
                with self.subTest(code=code):self.assertEqual(m.upload_video(url_config(),p,m.sha256_file(p),FakeOpener(upload_response(code)))[0],MEDIA_URI)

    def test_invalid_upload_responses_are_not_model_inputs(self):
        responses=[{'code':500,'message':'bad'}, {'code':False,'data':{'download_url':MEDIA_URI}}, {'code':0,'data':{'fileName':'input/x.mp4'}},
                   upload_response(download_url='http://media.example/x.mp4'),upload_response(type='image'),upload_response(size='999'),upload_response(size='invalid')]
        with tempfile.TemporaryDirectory() as t:
            p=Path(t)/'v.mp4';p.write_bytes(b'fake')
            for response in responses:
                opener=FakeOpener(response)
                with self.subTest(response=response):self.assertRaises(ValueError,m.upload_video,url_config(),p,m.sha256_file(p),opener)
                self.assertEqual(len(opener.requests),1)

    def test_file_changed_after_preflight_stops_before_upload(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t)/'v.mp4';p.write_bytes(b'before');digest=m.sha256_file(p);p.write_bytes(b'after');opener=FakeOpener()
            self.assertRaises(ValueError,m.upload_video,url_config(),p,digest,opener);self.assertFalse(opener.requests)

    def test_upload_failure_has_no_model_call_or_retry(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);v,cp,args=self.inputs(root);opener=FakeOpener(TimeoutError('upload timeout'))
            with mock.patch.object(m,'load_config',return_value=url_config()),mock.patch.object(m,'verify_video_against_shots'),mock.patch.object(m.urllib.request,'build_opener',return_value=opener):
                self.assertRaises(RuntimeError,m.main,args+['--execute']);self.assertRaises(ValueError,m.main,args+['--execute'])
            state=json.loads((root/'run/request-status.json').read_text())
            self.assertEqual(state['analysis_attempts'],0);self.assertEqual(state['upload_state'],'failed_or_unknown')
            self.assertEqual(len(opener.requests),1);self.assertEqual(json.loads(cp.read_text()),SCENE)

    def test_redirect_stops_instead_of_changing_upload_domain(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);v,cp,args=self.inputs(root);opener=FakeOpener(ValueError('带密钥请求不跟随重定向'))
            with mock.patch.object(m,'load_config',return_value=url_config()),mock.patch.object(m,'verify_video_against_shots'),mock.patch.object(m.urllib.request,'build_opener',return_value=opener):
                self.assertRaises(RuntimeError,m.main,args+['--execute'])
            self.assertEqual(len(opener.requests),1);self.assertEqual(json.loads((root/'run/request-status.json').read_text())['analysis_attempts'],0)

    def test_full_url_flow_fragmented_response_and_no_secrets_in_artifacts(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);v,cp,args=self.inputs(root);c=url_config();c[m.PREFIX+'UPLOAD_API_KEY']='test-upload-key'
            response=model_response();response['echo']={'key':c[m.PREFIX+'API_KEY'],'upload_key':c[m.PREFIX+'UPLOAD_API_KEY'],'url':MEDIA_URI}
            opener=FakeOpener(upload_response(),response)
            with mock.patch.object(m,'load_config',return_value=c),mock.patch.object(m,'verify_video_against_shots'),mock.patch.object(m.urllib.request,'build_opener',return_value=opener),mock.patch('sys.stdout',new_callable=io.StringIO) as output:
                m.main(args+['--execute']);self.assertRaises(ValueError,m.main,args+['--execute'])
                logs=output.getvalue()
            self.assertEqual([r.full_url for r in opener.requests],['https://upload.example/media/binary',m.request_url(c)])
            sent=json.loads(opener.requests[1].data);self.assertEqual(sent['contents'][0]['parts'][0]['fileData']['fileUri'],MEDIA_URI)
            state=json.loads((root/'run/request-status.json').read_text());self.assertEqual(state['state'],'completed')
            self.assertEqual((state['upload_attempts'],state['analysis_attempts']),(1,1));self.assertFalse(state['applied'])
            self.assertTrue(state['provenance']['video_input_confirmed']);self.assertEqual(json.loads(cp.read_text()),SCENE)
            artifacts='\n'.join(p.read_text() for p in (root/'run').iterdir() if p.is_file())+logs
            for private in [MEDIA_URI,'private-test-signature',c[m.PREFIX+'API_KEY'],c[m.PREFIX+'UPLOAD_API_KEY']]:self.assertNotIn(private,artifacts)
            self.assertEqual((root/'run/request-status.json').stat().st_mode & 0o777,0o600)

    def test_analysis_failure_after_upload_does_not_reupload_or_leak_url(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);v,cp,args=self.inputs(root);c=url_config();msg='bad '+MEDIA_URI+' '+c[m.PREFIX+'API_KEY']
            error=urllib.error.HTTPError(m.request_url(c),400,'bad',{},io.BytesIO(msg.encode()));opener=FakeOpener(upload_response(),error)
            with mock.patch.object(m,'load_config',return_value=c),mock.patch.object(m,'verify_video_against_shots'),mock.patch.object(m.urllib.request,'build_opener',return_value=opener):
                with self.assertRaises(RuntimeError) as raised:m.main(args+['--execute'])
                self.assertRaises(ValueError,m.main,args+['--execute'])
            state=json.loads((root/'run/request-status.json').read_text());self.assertEqual(state['upload_state'],'succeeded');self.assertEqual(state['analysis_state'],'failed_or_unknown')
            for private in [MEDIA_URI,c[m.PREFIX+'API_KEY']]:self.assertNotIn(private,json.dumps(state)+str(raised.exception))
            self.assertEqual(len(opener.requests),2);self.assertEqual(json.loads(cp.read_text()),SCENE)

    def test_redaction_handles_credentials_split_across_text_chunks(self):
        c=url_config();c[m.PREFIX+'UPLOAD_API_KEY']='split-upload-secret'
        text=json.dumps({'echo':MEDIA_URI+' '+c[m.PREFIX+'API_KEY']+' '+c[m.PREFIX+'UPLOAD_API_KEY']})
        response={'candidates':[{'content':{'parts':[{'text':text[i:i+5]} for i in range(0,len(text),5)]}}]}
        safe=m.sanitize(response,c,MEDIA_URI);serialized=json.dumps(safe);parsed=m.parse_answer(m.answer_text(safe))
        for private in [MEDIA_URI,'private-test-signature',c[m.PREFIX+'API_KEY'],c[m.PREFIX+'UPLOAD_API_KEY']]:
            self.assertNotIn(private,serialized);self.assertNotIn(private,parsed['echo'])

    def test_bad_model_json_preserves_response_and_stops(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);v,cp,args=self.inputs(root);opener=FakeOpener(upload_response(),{'candidates':[{'content':{'parts':[{'text':'not JSON'}]}}]})
            with mock.patch.object(m,'load_config',return_value=url_config()),mock.patch.object(m,'verify_video_against_shots'),mock.patch.object(m.urllib.request,'build_opener',return_value=opener):
                self.assertRaises(RuntimeError,m.main,args+['--execute'])
            self.assertTrue((root/'run/provider-response.json').is_file());self.assertEqual(len(opener.requests),2)

    def test_http_success_without_video_usage_is_not_video_confirmation(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);v,cp,args=self.inputs(root);response=model_response();response['usageMetadata']={};opener=FakeOpener(upload_response(),response)
            with mock.patch.object(m,'load_config',return_value=url_config()),mock.patch.object(m,'verify_video_against_shots'),mock.patch.object(m.urllib.request,'build_opener',return_value=opener),mock.patch('sys.stdout',new_callable=io.StringIO):m.main(args+['--execute'])
            self.assertFalse(json.loads((root/'run/analysis.json').read_text())['provenance']['video_input_confirmed'])

    def test_exclusive_ledger_preserves_first_run(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t)/'ledger.json';m.reserve_run(p,{'state':'first'});self.assertRaises(ValueError,m.reserve_run,p,{'state':'second'});self.assertEqual(json.loads(p.read_text()),{'state':'first'})

    def test_adjacent_text_parts_do_not_insert_newlines(self):
        r={'candidates':[{'content':{'parts':[{'text':'{"video'},{'thought':True,'text':'ignore'},{'text':'_observed":true}'}]}}]}
        self.assertEqual(m.parse_answer(m.answer_text(r)),{'video_observed':True})

    def test_multiple_candidates_are_not_joined(self):
        r={'candidates':[{'content':{'parts':[{'text':'{"first":true}'}]}},{'content':{'parts':[{'text':'{"other":true}'}]}}]}
        self.assertEqual(m.parse_answer(m.answer_text(r)),{'first':True})

    def test_truncated_response_is_not_success(self):
        self.assertRaises(ValueError,m.answer_text,{'candidates':[{'finishReason':'MAX_TOKENS','content':{'parts':[{'text':'{}'}]}}]})

    def test_reviewed_offline_apply_never_uploads_or_calls_model(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);v,cp,args=self.inputs(root);answer=root/'reviewed.json'
            prov={'model':'test','input_mode':'native_video_url','video_sha256':m.sha256_file(v),'timeline_binding':m.machine_binding(SHOTS),'review':{'approved':True}}
            answer.write_text(json.dumps({'analysis':analysis(),'provenance':prov}))
            with mock.patch.object(m,'verify_video_against_shots'),mock.patch.object(m,'load_config') as load,mock.patch.object(m,'upload_video') as upload,mock.patch.object(m,'remote_call') as remote,mock.patch('sys.stdout',new_callable=io.StringIO):
                m.main(args+['--response-file',str(answer),'--apply']);load.assert_not_called();upload.assert_not_called();remote.assert_not_called()
            self.assertTrue((root/'scene.before-model.json').exists());self.assertEqual(json.loads(cp.read_text())['setups'],SCENE['setups'])

if __name__=='__main__':unittest.main()
