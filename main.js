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
var log = util.log;

var versionP = util.readJsonFileP(
    path.join(__dirname, "package.json")
).get("version");

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

Bp.cliBuildP = function(version) {
    var program = require("commander");

    program.version(version)
        .option("-s, --schema <file>", "Schema file")
        .option("-o, --output-dir <directory>", "Output directory")
        .option("-n, --no-bundles", "Skip generating bundles (only generate CommonJS files)")
        .option("-c, --config [file]", "JSON configuration file (no file means STDIN)")
        .option("-w, --watch", "Continually rebuild")
        .parse(process.argv.slice(0));

    var workingDir = process.cwd();
    var schemaFile = absolutePath(workingDir, program.schema);
    var sourceDir = path.dirname(schemaFile);
    var outputDir = absolutePath(workingDir, program.outputDir);

    var watcher = new Watcher(
        sourceDir,
        program.watch
    ).on("changed", function(file) {
        if (program.watch) {
            log.err(file + " changed; rebuilding...", "yellow");
            rebuild();
        }
    });

    var inputP = Q.all([
        watcher,
        lockOutputDirP(outputDir),
        util.readJsonFileP(schemaFile),
        getConfigP(workingDir, program.config),
        !program.bundles
    ]);

    var buildP = this.buildP.bind(this);

    function rebuild() {
        if (rebuild.ing)
            return;
        rebuild.ing = true;

        inputP.spread(buildP).then(function(tree) {
            rebuild.ing = false;
            log.out(JSON.stringify(tree));
        })["catch"](function(err) {
            rebuild.ing = false;
            log.err(err.stack);
        });
    }

    rebuild();
};

function absolutePath(workingDir, pathToJoin) {
    workingDir = path.normalize(workingDir);
    pathToJoin = path.normalize(pathToJoin);
    if (pathToJoin.charAt(0) !== "/")
        pathToJoin = path.join(workingDir, pathToJoin);
    return pathToJoin;
}

function lockOutputDirP(outputDir) {
    return util.mkdirP(outputDir).then(function(dir) {
        var lockFile = path.join(outputDir, ".lock.pid");
        return util.acquireLockFileP(lockFile).then(function() {
            return dir;
        }, function(err) {
            throw new Error("output directory " + outputDir + " currently in use");
        });
    });
}

function getConfigP(workingDir, configFile) {
    if (typeof configFile === "undefined")
        return {}; // Empty config.

    var stdin = "/dev/stdin";
    if (configFile === true) {
        // When --config is present but has no argument, default to STDIN.
        configFile = stdin;
    }

    configFile = absolutePath(workingDir, configFile);

    if (configFile === stdin) {
        log.err(
            "Expecting configuration from STDIN (pass --config <file> " +
            "if stuck here)...",
            "yellow");
        return util.readJsonFromStdinP();
    }

    return util.readJsonFileP(configFile);
}

Bp.buildP = function(watcher, outputDir, schema, config, noBundles) {
    assert.ok(watcher instanceof Watcher);
    var cbs = this.callbacks;
    var context = new BuildContext(config, watcher, outputDir);
    var reader = new ModuleReader(context, cbs.source, cbs.module);
    var writer = noBundles ? null : new BundleWriter(context, cbs.bundle);
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

        versionP.then(function(version) {
            api.cliBuildP(version);
        });

        return api[name].apply(api, arguments);
    };
}
defCallback("source");
defCallback("module");
defCallback("bundle");

exports.Brigade = Brigade;
