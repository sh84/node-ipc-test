# node-ipc-test

Performance tests for inter-process communication (IPC).
* redis.js - use redis channels 
* native.js - build-in process.send
* socket.js - unix socket + JSON
* socket_opt1.js - unix socket + string manual parse
* socket_opt2.js - unix socket + Buffer

Run: node native.js workers parallel_threads payload_size

For example: node native.js 1 1 100 - run 1 worker with 1 thread and use 100 bytes payload for every message.
