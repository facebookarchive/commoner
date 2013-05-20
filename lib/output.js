var assert = require("assert");
var util = require("./util");
var inherits = util.inherits;
var log = util.log;

function AbstractOutput() {
    assert.ok(this instanceof AbstractOutput);
    Object.defineProperties(this, {
        outputModule: { value: this.outputModule.bind(this) }
    });
}

var AOp = AbstractOutput.prototype;
exports.AbstractOutput = AbstractOutput;

AOp.outputModule = function(module) {
    throw new Error("not implemented");
};

function StdOutput() {
    assert.ok(this instanceof StdOutput);
    AbstractOutput.call(this);
}

var SOp = inherits(StdOutput, AbstractOutput);
exports.StdOutput = StdOutput;

SOp.outputModule = function(module) {
    log.out(module.source);
};

function DirOutput(outputDir) {
    assert.ok(this instanceof DirOutput);
    assert.strictEqual(typeof outputDir, "string");
    AbstractOutput.call(this);

    Object.defineProperties(this, {
        outputDir: { value: outputDir }
    });
}

var DOp = inherits(DirOutput, AbstractOutput);
exports.DirOutput = DirOutput;

DOp.outputModule = function(module) {
    return module.writeVersionP(this.outputDir);
};

function TestOutput() {
    assert.ok(this instanceof TestOutput);
    AbstractOutput.call(this);
}

var TOp = inherits(TestOutput, AbstractOutput);
exports.TestOutput = TestOutput;

TOp.outputModule = function(module) {
    // Swallow any output.
};
