'use strict';
var Promise = require('bluebird');
var redis = Promise.promisifyAll(require('redis'));
var chai = require('chai');
var expect = chai.expect
  , should = chai.should();
var chaiAsPromised = require("chai-as-promised");
chai.use(chaiAsPromised);
var Queue = require('../index');

describe('RedisQueue', function () {
  var client;
  var queueName = 'test-reliable-queue';
  var values = ['test', 'me', 'please'];
  var redisUrl = 'redis://localhost:6379';

  before(function before() {
    client = redis.createClient(redisUrl);

    return new Promise(function(resolve, reject){
      client.on('ready', function(){
        // let's make sure the queue is empty
        return client.delAsync(queueName)
          .then(function(){
            // let's make sure the working queue is empty too
            return client.delAsync(Queue._workingQueue(queueName));
          })
          .then(function(){
            resolve();
          })

        console.log('redis is ready');
      });
      client.on('connected', function(){
        console.log('redis is connected');
      });
      client.on('error', function(err) {
        console.log('error connecting to redist: ' + err);
        reject(err);
      })
    });
  });

  it('should enqueue values', function () {
    var queue = new Queue(redisUrl, queueName);

    return Promise.settle(Promise.map(values, function(value){
      return queue.enqueueAsync(value);
    }))
      .then(function(){
        return client.lrangeAsync(queueName, 0, -1);
      })
      .then(function(newValues){
        expect(newValues.length).to.eq(values.length);
      })
      .should.be.fulfilled;
  });

  it('should process values', function(done) {
    var count = 0;
    var callback = function countValues(value){
      // values must be processed in order
      expect(value).to.deep.equal(values[count]);
      count++;
      if (count === values.length) {
        queue.stopDequeueing();
        // let's put some delay so that the queue
        // does its acking
        Promise.delay(100)
          .then(function(){
            // let's make sure the queue is empty
            return client.lrangeAsync(queueName, 0, -1);
          })
          .then(function(queueValues){
            expect(queueValues.length).to.equal(0);
            // let's make sure that the working queue is empty too
            return client.lrangeAsync(queue._workingQueueName, 0, -1);
          })
          .then(function(workingQueueValues){
            expect(workingQueueValues.length).to.equal(0);
          })
          .then(function(){
            done();
          })
      }

      return Promise.resolve();
    }

    var queue = new Queue(redisUrl, queueName, callback);
    queue.startDequeueingAsync();
  })

});
