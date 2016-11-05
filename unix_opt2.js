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
    let workers = Array.from(Array(workers_count), () => 
      child_process.fork(__filename, [workers_count, parallel, payload_size])
    );
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
      connection.on('data', buf => {
        //console.log('<<', buf);
        let msgs = decode(buf);
        //console.log('<<msgs', msgs);
        for (let msg of msgs) {
          if (msg.pid) {
            connection.pid = msg.pid;
            workers_hash[connection.pid].connection = connection;
            workers_hash[connection.pid].sendMsg = function(obj) {
              connection.write(encode(obj));
            };
          } else {
            workers_hash[connection.pid].emit('msg', msg);  
          }
        }
      }).on('error', err => console.error(err));
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
    connection.write(encode({pid: process.pid}));
  });
  connection.on('data', buf => {
    //console.log('>>', buf);
    let msgs = decode(buf);
    //console.log('>>msgs', msgs);
    for (let msg of msgs) {
      if (msg.id == messages_count) msg.cpu_usage = getCpuUsage() - cpu_usage;
      connection.write(encode(msg));
    }
  });
}

function decode(buf) {
  let result = [], pos = 0;
  //let accum_buf = decode.prev_buf ? Buffer.concat([decode.prev_buf, buf]) : buf;
  let accum_buf = buf;
  //decode.prev_buf = null;
  //console.log('len', accum_buf.length, accum_buf);
  while (pos < accum_buf.length) {
    /*if (accum_buf.length-pos != 5 && accum_buf.length-pos < 13+payload_size) {
      decode.prev_buf = accum_buf.slice(pos);
      console.log('to next:', accum_buf.length-pos, 13+payload_size, decode.prev_buf);
      break;
    }*/
    let obj = {};
    if (accum_buf[pos] == 1) {
      obj.pid = accum_buf.readUInt32LE(pos+1);
      pos += 5;
    } else {
      obj.id = accum_buf.readUInt32LE(pos+1);
      obj.uid = accum_buf.readUInt32LE(pos+5);
      obj.cpu_usage = accum_buf.readUInt32LE(pos+9);
      obj.payload = accum_buf.toString('utf8', pos+13, pos+13+payload_size);
      pos += 13+payload_size;
    }
    result.push(obj);
  }
  return result;
}
decode.prev_buf = null;

function encode(obj) {
  let buf;
  if (obj.pid) {
    buf = new Buffer(5);
    buf[0] = 1;
    buf.writeUInt32LE(obj.pid, 1);
  } else {
    buf = new Buffer(13+payload_size);
    buf[0] = 0;
    buf.writeUInt32LE(obj.id, 1);
    buf.writeUInt32LE(obj.uid, 5);
    buf.writeUInt32LE(obj.cpu_usage, 9);
    buf.write(obj.payload, 13);
  }
  return buf;
}