// Keep sherpa and the embedding ONNX runtime in separate processes.
const {Worker}=require('node:worker_threads'),path=require('node:path');
const dir=process.argv[2];
const worker=new Worker(path.resolve('apps/desktop/wake-worker.js'),{workerData:{dir,keywords:path.join(dir,'keywords.txt')}});
worker.on('message',m=>process.send?.(m));
process.on('message',m=>{worker.postMessage(m);if(m.type==='reset')process.send({id:m.id})});
process.on('disconnect',()=>worker.terminate());
