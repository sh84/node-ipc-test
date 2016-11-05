'use strict';

const workers_count  = process.argv[2]*1 || 1;
const parallel       = process.argv[3]*1 || 1;
const payload_size   = process.argv[4]*1 || 256;
const messages_count = 20000;

const socket_path = 'master.sock';
const child_process = require('child_process');
const fs = require('fs');
const net = require('net');
let payload, workers_hash = {};

if (process.send) {
  // worker
  workerRun();
} else {
  // master
  payload = require('crypto').randomBytes(payload_size/2).toString('hex');
  masterCreateServer().then(() => {
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
  });
}

function getCpuUsage() {
  let stat = fs.readFileSync(`/proc/${process.pid}/stat`).toString().split(' ');
  let utime = parseInt(stat[13]); // in ticks, tick = 1/10000 s
  let stime = parseInt(stat[14]);
  return (utime + stime) * 10; // to ms
}

function masterCreateServer() {
  return new Promise(done => {
    fs.existsSync(socket_path) && fs.unlinkSync(socket_path);
    net.createServer(connection => {
      connection.setEncoding('utf8');
      connection.on('data', data => {
        //console.log('<<', data);
        data.split('\n').forEach(s => {
          if (!s) return;
          let msg = JSON.parse(s);
          if (msg.pid) {
            connection.pid = msg.pid;
            workers_hash[connection.pid].connection = connection;
            workers_hash[connection.pid].sendMsg = function(obj) {
              connection.write(JSON.stringify(obj)+'\n');
            };
          } else {
            workers_hash[connection.pid].emit('msg', msg);  
          }
        });
      });
    }).listen(socket_path, () => {
      done();
    });
  });
}

function masterRun(worker) {
  masterRun.uid = masterRun.uid ? masterRun.uid + 1 : 1;
  let uid = masterRun.uid;
  workers_hash[worker.pid] = worker;
  return new Promise(done => {
    (function fn() { worker.sendMsg ? done() : setImmediate(fn) })();
  }).then(() => new Promise(done => {
    let id = 1, time = Date.now();
    worker.on('msg', msg => {
      if (msg.uid != uid) return;
      if (msg.id != id) console.error(`id from worker (${msg.id}) != ${id}`);
      if (id == messages_count) return done(msg.cpu_usage / (Date.now() - time));
      id = msg.id + 1;
      worker.sendMsg({id, uid, payload});
    });
    worker.sendMsg({id, uid, payload});
  }));
}

function workerRun() {
  let cpu_usage = getCpuUsage();
  const connection = net.createConnection(socket_path, () => {
    connection.write(JSON.stringify({pid: process.pid})+'\n');
  });
  connection.setEncoding('utf8');
  connection.on('data', data => {
    //console.log('>>', data);
    data.split('\n').forEach(s => {
      if (!s) return;
      let msg = JSON.parse(s);
      if (msg.id == messages_count) msg.cpu_usage = getCpuUsage() - cpu_usage;
      connection.write(JSON.stringify(msg)+'\n');
    });
  });
}
