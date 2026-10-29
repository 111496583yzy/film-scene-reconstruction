import copy
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
    return {m.PREFIX+k:v for k,v in {'API_BASE_URL':'https://provider.example/v1','MODEL':'vendor/test-model','PROTOCOL':'gemini_generate_content','REQUEST_PATH':'/v1beta/models/{model}:generateContent','AUTH_HEADER':'Authorization','AUTH_SCHEME':'Bearer','API_KEY':'test-key-not-for-real-use','MAX_REQUEST_BYTES':'1000000','MAX_OUTPUT_TOKENS':'1500','TIMEOUT_SECONDS':'10'}.items()}


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

if __name__=='__main__':unittest.main()
