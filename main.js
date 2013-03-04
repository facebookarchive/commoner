var assert = require("assert");
var path = require("path");
var Q = require("q");
var slice = Array.prototype.slice;

var Watcher = require("./lib/watcher").Watcher;
var BuildContext = require("./lib/context").BuildContext;
var ModuleReader = require("./lib/reader").ModuleReader;
var BundleWriter = require("./lib/writer").BundleWriter;
var Pipeline = require("./lib/pipeline").Pipeline;
var util = require("./lib/util");

function Brigade() {
    var self = this;
    assert.ok(self instanceof Brigade);

    self.callbacks = {
        source: [],
        module: [],
        bundle: []
    };
}

var Bp = Brigade.prototype;

Bp.cliBuildP = function() {
    var program = require("commander");

    program.version("0.3.1")
        .option("-s, --schema <file>", "Schema file")
        .option("-o, --output-dir <directory>", "Output directory")
        .option("-c, --config <file>", "JSON configuration file (- to read from STDIN)")
        .option("-w, --watch", "Continuously rebuild (TODO)")
        .parse(process.argv.slice(0));

    var workingDir = process.cwd();
    var schemaFile = path.normalize(path.join(workingDir, program.schema));
    var sourceDir = path.dirname(schemaFile);
    var outputDir = path.normalize(path.join(workingDir, program.outputDir));
    var configP = (program.config === "-")
        ? util.readJsonFromStdinP()
        : program.config
            ? util.readJsonFileP(path.join(workingDir, program.config))
            : Q.resolve({ debug: false });

    return Q.all([
        new Watcher(sourceDir),
        util.mkdirP(outputDir),
        util.readJsonFileP(schemaFile),
        configP,
    ]).spread(this.buildP.bind(this)).then(function(tree) {
        process.stdout.write(JSON.stringify(tree));
        process.stdout.write("\n");
    }).done();
};

Bp.buildP = function(watcher, outputDir, schema, config) {
    assert.ok(watcher instanceof Watcher);
    var cbs = this.callbacks;
    var context = new BuildContext(config, watcher, outputDir);
    var reader = new ModuleReader(context, cbs.source, cbs.module);
    var writer = new BundleWriter(context, cbs.bundle);
    var pipeline = new Pipeline(context, reader, writer);
    return pipeline.setSchema(schema).getTreeP();
};

function defCallback(name) {
    Bp[name] = function(callback) {
        var cbs = this.callbacks[name];
        assert.ok(cbs instanceof Array);
        slice.call(arguments, 0).forEach(function(callback) {
            assert.strictEqual(typeof callback, "function");
            cbs.push(callback);
        });
        return this;
    };

    exports[name] = function() {
        var api = new Brigade;
        process.nextTick(api.cliBuildP.bind(api));
        return api[name].apply(api, arguments);
    };
}
defCallback("source");
defCallback("module");
defCallback("bundle");

exports.Brigade = Brigade;
