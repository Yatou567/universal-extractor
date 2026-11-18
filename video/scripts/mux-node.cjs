// 测试时加载同一份浏览器打包库，不是产品运行服务。
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
module.exports=vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../vendor/mux.min.js'),'utf8')+';muxjs;',{window:{},Uint8Array,ArrayBuffer,DataView,Uint16Array,Uint32Array,Int32Array,setTimeout,clearTimeout,console});
