exports.name = "scan-deps";

exports.version = 1;

var getRequiredIDs = require("install").getRequiredIDs;

exports.build = function(context, source) {
    var deps = context.deps;
    deps.push.apply(deps, getRequiredIDs(context.id, source));
    return source;
};
