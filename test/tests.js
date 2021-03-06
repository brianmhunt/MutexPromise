//
// Test the MutexPromise implementation.
//
/*  eslint no-console: 0 */
const sinon = require('sinon')
const assert = require('chai').assert


// Enable/Disable the Promise A+ spec.
const PERFORM_APLUS_TESTS = true

// We do not ever want to refer to the global promise.
global.Promise = null

const MP = require('../src/MutexPromise')

const APLUS_ADAPTER = {
  deferred: function deferred() {
    var res, rej
    var p = new MP(function (res_, rej_) { res = res_; rej = rej_ })
    return {
      promise: p,
      resolve: res,
      reject: rej
    }
  }
}

function noop() { return arguments[0] }


function handlerSpy(eventName) {
  var spy = sinon.spy()
  MP.on(eventName, spy)
  after(() => MP.off(eventName, spy))
  return spy
}


// Run the Promises A+ suite
describe("Promises A+", function () {
  if (PERFORM_APLUS_TESTS) {
    require('promises-aplus-tests').mocha(APLUS_ADAPTER)
  }
})


// Out MutexPromise-specific tests
describe("MutexPromise", function () {
  beforeEach(function () { MP.setMutex(this.currentTest.title) })
  afterEach(() => MP.eventHandlers = {})


  it("can be constructed as an instance of the class", function () {
    var mp = new MP(function () {})
    assert.instanceOf(mp, MP)
  })

  it("has MutexPromise.resolve", function () {
    var val = {x: '123'}
    var p = MP.resolve(val)
    assert.instanceOf(p, MP)
    return p.then((v2) => assert.strictEqual(val, v2))
  })

  it("has MutexPromise.reject", function () {
    var val = {x: '123'}
    var p = MP.reject(val)
    assert.instanceOf(p, MP)
    return p.catch(r => r).then((v2) => assert.strictEqual(val, v2))
  })

  it("instances have .finally", function () {
  })

  it("throws if no function is given to constructor", function() {
    assert.throws(() => new MP(), /is not a function/)
  })

  describe('.race', function () {
    it('resolves the an primitive', async () =>
      assert.equal(await MP.race([1]), 1)
    )
    it('resolves a promise', async () =>
      assert.equal(await MP.race([MP.resolve(1)]), 1)
    )
    it('resolves the first promise', async () =>
      assert.equal(await MP.race([MP.resolve(1), 2]), 2)
    )
    it('rejects the first rejection', async () => {
      let x = 0
      await MP.race([MP.reject(1), MP.resolve(2)]).catch(v => (x = v))
      assert.equal(x, 1)
    })
  })


  describe(".finally", function () {
    it("taps resolutions", function () {
      var val = { x: '123' }
      var called = false
      return MP.resolve(val)
        .finally(() => called = true)
        .then(
          function (reason) {
            assert.ok(called)
            assert.strictEqual(reason, val)
          },
          function () { throw Error("Do not call") }
        )
    })

    it("taps rejections", function () {
      var val = { x: '123' }
      var called = false
      return MP.reject(val)
        .finally(() => called = true)
        .then(
          function () { throw Error("Do not call") },
          function (reason) {
            assert.ok(called)
            assert.strictEqual(reason, val)
          }
        )
    })
  })

  describe('events', function () {
    it("triggers 'new'", function() {
      var spy = handlerSpy('new')
      assert.equal(spy.callCount, 0)
      var p = new MP(function () {})
      assert.equal(spy.callCount, 1)
      assert.strictEqual(spy.thisValues[0], p)
    })

    it("triggers 'resolve'", function () {
      var spy = handlerSpy('resolve')
      assert.equal(spy.callCount, 0)
      return new MP(function (res) { res('rqs') })
        .then(noop) // events are called after `then` resolutions
        .then(function (r) {
          assert.equal(spy.callCount, 1)
          assert.equal(r, 'rqs')
        })
    })

    it("triggers 'reject'", function () {
      var spy = handlerSpy('reject')
      assert.equal(spy.callCount, 0, 'sc0')
      return new MP(function (res,rej) { rej(new Error('rqt')) })
        .catch(noop)
        .then(function (reason) {
          assert.equal(spy.callCount, 1, 'sc1')
          assert.equal(reason.message, 'rqt')
        })
    })

    it("triggers 'uncaught'", function (done) {
      var spy = handlerSpy('uncaught')

      assert.equal(spy.callCount, 0)
      new MP(function (res,rej) { rej('rqu') })
      setTimeout(function () {
        assert.equal(spy.callCount, 1)
        done()
      }, 150)
    })

    it("does not trigger 'uncaught' on rejected return", function () {
      return new MP(function (res) { res('123') })
        .then(() => MP.reject("-- inside --!"))
        .catch(function () { })
    })

    it("does not trigger 'uncaught' on Promise.all", function () {
      return MP.all([
        MP.reject('x'),
        MP.resolve('y')
      ]).catch(() => 123)
    })

    it("triggers 'trespass' on chained 'then's across mutexes", function () {
      var spy = handlerSpy('trespass')
      var p0 = new MP(function (res) { res('123') })
      MP.setMutex('b')

      // Three 'tresspass' events:
      //    1. p0 resolves;
      //    2. p0 chains to .then;
      //    3. .then promise resolves.
      return p0
        .then(() => assert.equal(spy.callCount, 3))
    })

    it("triggers 'trespass' on resolutions across sync mutexes", function () {
      var spy = handlerSpy('trespass')
      return new MP(function (res) {
        MP.setMutex('b')
        res('123')
      })
        .then(() => assert.equal(spy.callCount, 3))
    })

    it("triggers 'trespass' on resolutions across async mutexes", function () {
      var spy = handlerSpy('trespass')
      return new MP(function (res) {
        MP.setMutex('b')
        setTimeout(() => res('123'), 1)
      })
        .then(() => assert.equal(spy.callCount, 3))
    })

    it("triggers 'trespass' for async then's", function () {
      var spy = handlerSpy('trespass')
      var p = new MP((res) => res('x'))
        .then(() => MP.setMutex('b'))
      return p.then(() => assert.equal(spy.callCount, 1))
    })

    it("triggers trespass via .all", function () {
      var spy = handlerSpy('trespass')
      // MP.on('trespass', function (data) {
      //   console.log(" ⚡️   ", data)
      //   console.trace()
      // })
      var p0 = new MP(function (res) {
        setTimeout(function () {
          res()
          MP.setMutex('rx')
        }, 1)
      })

      return MP.all([0, p0, 1, 2])
        .then(() => assert.equal(spy.callCount, 4))
    })
  })

  it("marks promises as caught", function () {
    var p = MP.resolve()
    assert.notOk(p._isCaught)

    p.catch(noop)
    assert.ok(p._isCaught)
  })

  it("marks nested promises as caught", function () {
    var p0 = MP.resolve("p0")
    var p1 = p0.then(function p1f(){})
    assert.notOk(p0._isCaught, 'p0')
    assert.notOk(p1._isCaught, 'p1')

    var p0c = p0.catch(function p0cf(){})
    var p1c = p1.catch(function p1cf(){})

    assert.ok(p0._isCaught, 'p0+')
    assert.ok(p1._isCaught, 'p1+')
    assert.ok(p0c._isCaught, 'p0c')
    assert.ok(p1c._isCaught, 'p1c')
  })

  it("marks then-promises as caught", function () {
    var p1
    var p0 = MP.resolve()
      .then(() => p1 = MP.resolve())
      .then(function () {
        assert.notOk(p1._isCaught, 'p1x')
        p0.catch(noop)
        assert.ok(p1._isCaught, 'p1o')
      })
  })

  it("does not mark outer promises as caught", function () {
    var p1
    var p0 = MP.resolve()
      .then(() => p1 = MP.resolve())
      .then(function () {
        p1.catch(noop)
        assert.ok(p1._isCaught, 'p1o')
        assert.notOk(p0._isCaught, 'p0x')
      })
      // Prevent 'uncaught' event bleed
      .catch(noop)
  })

  describe("Promise.all", function () {
    it("Returns the result of all promises", function () {
      return MP.all([
        MP.resolve('ab'),
        MP.resolve('a').then(() => 'b'),
        'step',
        null
      ]).then(function (results) {
        assert.equal(results[0], 'ab')
        assert.equal(results[1], 'b')
        assert.equal(results[2], 'step')
        assert.equal(results[3], null)
      })
    })

    it("trespass raised when mutexes differ", function () {
      var a, b
      a = MP.resolve(1)
      b = MP.resolve(2)
      a.mutexTo = 'A'
      b.mutexTo = 'B'

      return new MP((resolve) => {
        MP.on('trespass', resolve)
        MP.all([a, b])
      })
        .then((tp) => assert.equal(tp.during, 'chain'))
    })

    it("finishes when given an empty array", function () {
      return MP.all([])
    })

    it.skip("Marks its argument-promises as caught", function () {
      var p0 = MP.resolve('ab')
      return MP.all([p0])
        .then(() => assert.notOk(p0.isCaught))
        .catch(noop) // this occurs before weCatchFor.push; FIXME
        .then(() => assert.ok(p0.isCaught))
    })

    it("iterates over generator functions", function () {
      function* gen() {
        yield 1
        yield 2
      }
      return MP.all(gen())
        .then((v) => assert.deepEqual(v, [1, 2]))
    })
  })

  // describe("Promise.race", function () {
  //
  // })
})
