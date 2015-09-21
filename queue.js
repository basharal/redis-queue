module.exports = (function(global){
  'use strict';

  var Promise = require('bluebird');
  var events = require('events');
  var _ = require('underscore');
  var processEvent = 'process-queue';
  var redis = Promise.promisifyAll(require('redis'));

  // A Reliable-Queue for Redis
  // ==========================
  // This library provides a reliable queue for Redis where
  // each value is guaranteed to be processed at least once
  // even in case of failures. The only constraint is that
  // there should be ONLY a single consumer for the queue.
  //
  // The library also depends heavily on
  // [bluebird promises](https://github.com/petkaantonov/bluebird).

  // `Queue` class
  // -------------
  // `Queue` represents a reliable-redis queue
  //
  // `url` is the url for the redis instance.
  // `queueName` represents a redis `LIST`
  // `fn` represents the callback that will be called once for
  // each value in the queue
  function Queue(url, queueName, fn) {
    this._client = redis.createClient(url);
    this._queueName = queueName;
    // if we're dequeuing, then we will need the extra queues
    if (fn) {
      this._workingQueueName = Queue._workingQueue(queueName);
      this._errorQueueName = Queue._errorQueue(queueName);
      this._callback = fn;
      this.on(processEvent, this._processLoop);
    }
  }

  Queue.prototype.__proto__ = events.EventEmitter.prototype;
  Queue._workingQueue = function _workingQueue(name) {
    return name + '-working';
  }
  Queue._errorQueue = function _errorQueue(name) {
    return name + '-error';
  }


  // `startDequeuing` starts processing the queue
  Queue.prototype.startDequeueingAsync = function startDequeueing() {
    if (this._started) {
      throw new Error('queue has already been started');
    }

    if (!this._callback) {
      throw new Error('you must pass a callback for dequeuing');
    }

    var self = this;
    // we need to make sure the processing queue is empty
    // in case there was some values already due to a previous
    // run in the middle of a crash.
    // We could have inserted, then deleted, but if the code crashes
    // then we could double insert. This is safer, but less-performant.
    var tempQueues = [this._workingQueueName, this._errorQueueName];
    var promises = _.map(tempQueues, function(queueName) {
      return self._client.lrangeAsync(queueName, 0, -1)
        .then(function (values) {
          return Promise.settle(Promise.map(values, function (value) {
            // put the value back. The order should be maintained, since all
            // we're doing is moving values from the head of one queue to the tail
            // of another
            return self._client.rpoplpushAsync(queueName, self._queueName);
          }));
        });
    });

    return Promise.settle(promises)
      .then(function(){
        self._started = true;
        self.emit(processEvent);
      })
  }

  // `stopDequeuing` stops processing from the queue. However,
  // if it's in the middle of processing the callback function,
  // it will process it complete, then stop.
  Queue.prototype.stopDequeueing = function stopDequeuing() {
    this._started = false;
    this.removeAllListeners(processEvent);
    return this;
  }

  // `_processLoop` is an internal function to dequeue, call the callback,
  // and re-enqueue back if necessary
  Queue.prototype._processLoop = function _processLoop() {
    var self = this;
    return self._dequeueAsync()
      .then(function(value){
        // let's call the callback
        // if somehow we were stopped. let's not
        // process this event and requeue it
        if (!self._started) {
          return self._failAsync(value);
        }

        self._pendingValue = value;

        return self._callback(value)
          .then(function(){
            // let's ack
            return self._ackAsync(value)
          })
          .catch(function(err){
            return self._failAsync(value);
          })
          .finally(function(){
            if (self._started) {
              // let's reprocess again if we haven't stopped
              self.emit(processEvent);
            }
          })
      })
  }

  // `enqueueAsync` enqueues the given array of `values` to the queue
  Queue.prototype.enqueueAsync = function enqueueAsync(values) {
    return this._client.lpushAsync(this._queueName, values);
  }

  // this will block until there is an item
  Queue.prototype._dequeueAsync = function _dequeueAsync() {
    if (this._pendingValue) {
      return Promise.reject(new Error('cannot dequeue without acking/failing request'));
    };

    // will returns only when there is a new value in the queue
    return this._client.brpoplpushAsync(this._queueName, this._workingQueueName, 0);
  }

  // `_ackAsync` will remove the pending value from the working queue.
  Queue.prototype._ackAsync = function _ackAsync(value) {
    if (!this._pendingValue) {
      return Promise.reject(new Error('there is no pending value'));
    }

    var self = this;

    return this._client.lpopAsync(this._workingQueueName)
      .then(function(storedValue){
        if (storedValue !== value) {
          return self._client.rpushAsync(self._workingQueueName, storedValue)
            .then(function(){
              throw new Error('unexpected! values must match: '
                + value + ' vs ' + storedValue);
            })
        } else {
          // values match
          self._pendingValue = null;
        }
      });
  }

  // `_failAsync` will re-enqueues the value back to the queue to be processed again
  Queue.prototype._failAsync = function _failAsync(value) {
    if (!this._pendingValue) {
      return Promise.reject(new Error('there is no pending value'));
    }

    var self = this;
    // to avoid infinite loops with errors. Let's put the failing values into an
    // error queue to avoid loops
    return this._client.rpoplpushAsync(this._workingQueueName, this._errorQueueName)
      .then(function(storedValue){
        if (storedValue !== value) {
          throw new Error('unexpected! values must match: '
                + value + ' vs ' + storedValue);
        } else {
          self._pendingValue = null;
        }
      });
  }

  return Queue;

}(this));
