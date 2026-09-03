import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
const root=process.cwd();
const server=createServer(async (req,res)=>{try{const path=normalize(req.url==='/'?'/public/catalog/review.html':req.url||'/');if(path.includes('..')){res.writeHead(403);return res.end()}const file=join(root,path);const data=await readFile(file);const type=file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'application/octet-stream';res.writeHead(200,{'content-type':type});res.end(data)}catch{res.writeHead(404);res.end('Not found')}});
server.listen(Number(process.env.REVIEW_PORT||0),'127.0.0.1',()=>{const a=server.address();if(a&&typeof a==='object')console.log(`Review gallery: http://127.0.0.1:${a.port}/public/catalog/review.html`)});
process.on('SIGINT',()=>server.close(()=>process.exit(0)));process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
