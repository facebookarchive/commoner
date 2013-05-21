var assert = require("assert");
var path = require("path");
var makePromise = require("./util").makePromise;
var recast = require("recast");
var n = recast.namedTypes;

exports.relativizeP = function(id, source) {
    return makePromise(function(callback) {
        recast.runString(source, function(ast, callback) {
            callback(new RequireVisitor(id).visit(ast));
        }, {
            writeback: function(code) {
                callback(null, code);
            }
        });
    });
};

var RequireVisitor = recast.Visitor.extend({
    init: function(moduleId) {
        this.moduleId = moduleId;
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
                arg.value = relativize(this.moduleId, arg.value);
                return;
            }
        }

        this.genericVisit(exp);
    }
});

function relativize(moduleId, requiredId) {
    if (requiredId.charAt(0) === ".") {
        // Keep the required ID relative.
    } else {
        // Relativize the required ID.
        requiredId = path.relative(
            path.join(moduleId, ".."),
            requiredId
        );
    }

    requiredId = path.normalize(requiredId);
    if (requiredId.charAt(0) !== ".")
        requiredId = "./" + requiredId;

    return requiredId;
}
