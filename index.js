console.time('init')

var AWS = require('aws-sdk')
var Promise = require('bluebird')
var exec = require('./lib/exec')
var fs = Promise.promisifyAll(require('fs'))
var s3 = Promise.promisifyAll(new AWS.S3())
const BUCKET = 'lilybin-scores'
const LY_DIR = process.env.LAMBDA_TASK_ROOT + '/ly'

process.chdir('/tmp')
process.env.PATH += ':' + LY_DIR + '/usr/bin'
process.env.LD_LIBRARY_PATH = LY_DIR + '/usr/lib'

var mime = {
  'pdf' : 'application/pdf'
, 'midi': 'audio/midi'
, 'png' : 'image/png'
}

exports.handler = function(event, context) {
  console.log('Received event:', JSON.stringify(event, null, 2))
  makeTime('init', 'writing input')

  return Promise.join(
    fs.writeFileAsync('input.ly', event.body),
    fs.unlinkAsync('rendered.pdf').catch(noop),
    fs.unlinkAsync('rendered.midi').catch(noop)
  ).bind({
    key : event.key
  }).tap(makeTime.bind(null, 'writing input', 'lilypond'))
  .then(exec.bind(
    null,
    'lilypond --formats=pdf -o rendered input.ly >&2'
  ))
  .then(function (res) {
    this.result = res
  }).tap(makeTime.bind(null, 'lilypond', 'upload'))
  .then(function () {
    return uploadFiles(this.key, this.result)
  }).tap(console.timeEnd.bind(console, 'upload'))
  .then(function () {
    context.succeed(this.result)
  }).catch(context.fail.bind(context))
}

function makeTime (end, begin) {
  console.timeEnd(end)
  console.time(begin)
}

function uploadFile (key, file, mode) {
  return fs.readFileAsync(file)
  .then(function (data) {
    return s3.putObjectAsync({
      Bucket      : BUCKET
    , Key         : key
    , Body        : data
    , ContentType : mime[mode]
    , StorageClass: 'REDUCED_REDUNDANCY'
    })
  }).then(function () {
    return true
  }).catch(function () {
    return false
  })
}

function uploadFiles (key, res) {
  var pdfPromise = uploadFile(key + '.pdf', 'rendered.pdf', 'pdf')
  var midiPromise = uploadFile(key + '.midi', 'rendered.midi', 'midi')

  return Promise.join(pdfPromise, midiPromise, function (pdf, midi) {
    res.files = { pdf: pdf, midi: midi }
  })
}

function noop () {}
