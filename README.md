Redis Queue for Node
====================

This library provides a Node module for a reliable queue for Redis where
each value is guaranteed to be processed *at least once* even in case of failures. 
The only constraint is that there should be ONLY a single consumer for the queue.
The library relies heavily on [Promises](https://github.com/petkaantonov/bluebird).
Therefore, it expects the given redis client to support promises.
The code is fully annotated.

## Installation
```
npm install redis-queue
```

## Usage

    var Promise = require('bluebird');
    var redis = Promise.promisifyAll(require('redis'));
    var Queue = require('redis-queue);
    var redisClient = redis.createClient('redis://localhost:6379');

### Enqueue
`enqueueAsync`, which will return a promise that will enqueue
 values to the queue as follows:
    
    var queue = new Queue(redisClient, 'myqueuename');
    // to enqueue a single value
    queue.enqueueAsync('foo');
    // to enqueue multiple values
    queue.enqueueAsync(['foo', 'bar']);

### Dequeue
`Queue`'s constructor provides a parameter `fn` that will be called back for each value that
is popped-off the queue. It will get called at *at least once*. It may get called more than
once in the even of failures/crashes. The contract is that `fun` must return a *Promise*.
Once the promise is resolved, it will be popped-off the queue, otherwise, it will get re-queued.
    var callback = function callback(value) {
      // do something and return a Promise
    }
    
    var queue = new Queue(redisClient, 'myqueuename', callback);
    queue.startDequeueingAsync();

    // if for some reason, you want to stop processing
    queue.stopDequeueingAsync();

