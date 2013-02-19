var assert = require("assert");
var minify = require("uglify-js").minify;
assert.strictEqual(typeof minify, "function");

exports.name = "uglify";

exports.version = 2;

exports.build = function(context, source) {
    var result = minify(source, { fromString: true });
    return result.code;
};
