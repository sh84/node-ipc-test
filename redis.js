'use strict';

const workers_count  = process.argv[2]*1 || 1;
const parallel       = process.argv[3]*1 || 1;
const payload_size   = process.argv[4]*1 || 256;
const messages_count = 20000;
const redis_unix_path = '/tmp/redis.sock'; // null to default tcp localhost

const child_process = require('child_process');
const fs = require('fs');
const redis = require('redis');
let payload;

if (process.send) {
  // worker
  workerRun();
} else {
  // master
  payload = require('crypto').randomBytes(payload_size/2).toString('hex');
  let master_cpu_usage = getCpuUsage(), time = Date.now();
  let workers = Array.from(Array(workers_count), () => child_process.fork(__filename));
  let promises = [];
  workers.forEach(worker => {
    Array.from(Array(parallel), () => {
      promises.push(masterRun(worker));
    });
  });
  Promise.all(promises).then(function(results) {
    master_cpu_usage = getCpuUsage() - master_cpu_usage;
    time = Date.now() - time;
    master_cpu_usage = master_cpu_usage / time;
    let workers_cpu_usage = results.reduce((sum, r) => sum + r) / parallel;
    let speed = messages_count * workers_count * parallel / time;
    console.log(`test for ${workers_count} workers, parallel=${parallel}, payload_size=${payload_size}`);
    console.log(`time: ${time}ms`);
    console.log(`master cpu usage: ${(100*master_cpu_usage).toFixed()}%`);
    console.log(`workers cpu usage: ${(100*workers_cpu_usage).toFixed()}%`);
    console.log(`result: ${(1000*speed).toFixed()} msg/s`);
    process.exit();
  });
}

function getCpuUsage() {
  let stat = fs.readFileSync(`/proc/${process.pid}/stat`).toString().split(' ');
  let utime = parseInt(stat[13]); // in ticks, tick = 1/10000 s
  let stime = parseInt(stat[14]);
  return (utime + stime) * 10; // to ms
}

function masterRun(worker) {
  masterRun.uid = masterRun.uid ? masterRun.uid + 1 : 1;
  let uid = masterRun.uid;
  return new Promise(function(done) {
    let id = 1, time = Date.now();
    let sub = redis.createClient(redis_unix_path), pub = redis.createClient(redis_unix_path);
    sub.subscribe('master_'+worker.pid);
    sub.on('message', (_, data) => {
      //console.log('<<', data);
      if (data == 'ready') return pub.publish('worker_'+worker.pid, JSON.stringify({id, uid, payload}));
      let msg = JSON.parse(data);
      if (msg.uid != uid) return;
      if (msg.id != id) console.error(`id from worker (${msg.id}) != ${id}`);
      if (id == messages_count) return done(msg.cpu_usage / (Date.now() - time));
      id = msg.id + 1;
      pub.publish('worker_'+worker.pid, JSON.stringify({id, uid, payload}));
    });
  });
}

function workerRun() {
  let cpu_usage = getCpuUsage();
  let sub = redis.createClient(redis_unix_path), pub = redis.createClient(redis_unix_path);
  sub.on('message', (_, data) => {
    //console.log('>>', data);
    let msg = JSON.parse(data);
    if (msg.id == messages_count) msg.cpu_usage = getCpuUsage() - cpu_usage;
    pub.publish('master_'+process.pid, JSON.stringify(msg));
  });
  sub.on('subscribe', () => {
    pub.publish('master_'+process.pid, 'ready');
  });
  sub.subscribe('worker_'+process.pid);
}
