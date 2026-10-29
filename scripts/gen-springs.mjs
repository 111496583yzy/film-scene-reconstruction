#!/usr/bin/env node
// 开发用：按阻尼谐振子采样生成 CSS linear() 弹簧曲线（mass=1）。
// response(秒) 与 dampingFraction 对应 SwiftUI：stiffness=(2π/response)²，damping=4π·ζ/response。
const springs={snappy:{response:.26,zeta:.63},bouncy:{response:.3,zeta:.48},smooth:{response:.4,zeta:1}};
function x(t,{response,zeta}){const w=2*Math.PI/response;if(zeta>=1)return 1-Math.exp(-w*t)*(1+w*t);const wd=w*Math.sqrt(1-zeta*zeta);return 1-Math.exp(-zeta*w*t)*(Math.cos(wd*t)+zeta*w/wd*Math.sin(wd*t));}
function settle(p){for(let t=2;t>0;t-=.001){if(Math.abs(1-x(t,p))>.006)return t+.001;}return .3;}
const out={};for(const [k,p] of Object.entries(springs)){const d=settle(p),N=40,pts=[];let peak=0;for(let i=0;i<=N;i++){const v=i===N?1:x(d*i/N,p);peak=Math.max(peak,v);pts.push(+v.toFixed(4));}
out[k]={durationMs:Math.round(d*1000),overshootPct:+((peak-1)*100).toFixed(1),stiffness:+((2*Math.PI/p.response)**2).toFixed(1),damping:+(4*Math.PI*p.zeta/p.response).toFixed(2),...p,css:`linear(${pts.join(',')})`,samples:pts};}
console.log(JSON.stringify(out,null,1));
