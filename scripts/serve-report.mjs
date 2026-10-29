#!/usr/bin/env node
// Optional local preview with byte ranges (plain static servers may break seeking).
import { createServer } from 'node:http';
import { createReadStream, realpathSync, statSync } from 'node:fs';
import { resolve, relative, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
export function createReportServer(directory) {
  const root=realpathSync(directory);
  return createServer((req,res)=>{
    try {
      if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{'Allow':'GET, HEAD'});res.end();return;}
      const path=realpathSync(resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname)));
      const rel=relative(root,path);
      if(rel==='..'||rel.startsWith('..'+sep)||resolve(path)===root){res.writeHead(403);res.end();return;}
      const st=statSync(path);if(!st.isFile()){res.writeHead(404);res.end();return;}
      const mime={'.html':'text/html; charset=utf-8','.json':'application/json; charset=utf-8','.mp4':'video/mp4','.webm':'video/webm','.mov':'video/quicktime','.jpg':'image/jpeg','.png':'image/png'}[extname(path).toLowerCase()]||'application/octet-stream';
      const headers={'Content-Type':mime,'Accept-Ranges':'bytes','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
      let start=0,end=st.size-1,code=200;
      if(req.headers.range){
        const m=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        if(!m||(!m[1]&&!m[2])||!st.size){res.writeHead(416,{...headers,'Content-Range':`bytes */${st.size}`});res.end();return;}
        if(!m[1]){start=Math.max(0,st.size-Number(m[2]));}else{start=Number(m[1]);if(m[2])end=Math.min(end,Number(m[2]));}
        if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=st.size||end<start){res.writeHead(416,{...headers,'Content-Range':`bytes */${st.size}`});res.end();return;}
        code=206;headers['Content-Range']=`bytes ${start}-${end}/${st.size}`;
      }
      headers['Content-Length']=Math.max(0,end-start+1);res.writeHead(code,headers);
      if(req.method==='HEAD'||!st.size){res.end();return;}
      const stream=createReadStream(path,{start,end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
    } catch(e){if(!res.headersSent)res.writeHead(e.code==='ENOENT'?404:400);res.end();}
  });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const directory=process.argv[2];if(!directory){process.stderr.write('Usage: node serve-report.mjs <report-directory>\n');process.exitCode=1;}
  else{const server=createReportServer(directory);server.listen(0,'127.0.0.1',()=>process.stdout.write(`本机预览：http://127.0.0.1:${server.address().port}/scene-report.html\n按 Ctrl+C 停止；仅本机可访问。\n`));}
}
