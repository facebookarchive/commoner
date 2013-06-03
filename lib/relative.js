var assert = require("assert");
var Q = require("q");
var path = require("path");
var util = require("./util");
var recast = require("recast");
var n = recast.namedTypes;

function Relativizer(reader) {
    assert.ok(this instanceof Relativizer);
    assert.ok(reader === null ||
              reader instanceof require("./reader").ModuleReader);

    Object.defineProperties(this, {
        reader: { value: reader }
    });
}

var Rp = Relativizer.prototype;

exports.getProcessor = function(reader) {
    var relativizer = new Relativizer(reader);
    return function(id, source) {
        return relativizer.processSourceP(id, source);
    };
};

Rp.processSourceP = function(id, source) {
    var visitor = new RequireVisitor(this, id);
    var ast = visitor.visit(recast.parse(source));
    return Q.all(visitor.promises).then(function() {
        return recast.print(ast);
    });
};

Rp.absolutizeP = function(moduleId, requiredId) {
    requiredId = util.absolutize(moduleId, requiredId);

    if (this.reader)
        return this.reader.getCanonicalIdP(requiredId);

    return Q.resolve(requiredId);
};

Rp.relativizeP = function(moduleId, requiredId) {
    return this.absolutizeP(
        moduleId,
        requiredId
    ).then(function(absoluteId) {
        return util.relativize(moduleId, absoluteId);
    });
};

var RequireVisitor = recast.Visitor.extend({
    init: function(relativizer, moduleId) {
        assert.ok(relativizer instanceof Relativizer);
        this.relativizer = relativizer;
        this.moduleId = moduleId;
        this.promises = [];
    },

    fixRequireP: function(literal) {
        var promise = this.relativizer.relativizeP(
            this.moduleId,
            literal.value
        ).then(function(newValue) {
            return literal.value = newValue;
        });

        this.promises.push(promise);
    },

    visitCallExpression: function(exp) {
        var callee = exp.callee;
        if (n.Identifier.check(callee) &&
            callee.name === "require" &&
            exp.arguments.length === 1)
        {
            var arg = exp.arguments[0];
            if (n.Literal.check(arg) &&
                typeof arg.value === "string")
            {
                this.fixRequireP(arg);
                return;
            }
        }

        this.genericVisit(exp);
    }
});
