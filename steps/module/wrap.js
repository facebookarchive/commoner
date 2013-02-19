exports.name = "cjs-wrap";

exports.version = 2;

exports.build = function(context, source) {
    return "install(ID,function(require,exports,module){SRC});"
        .replace("ID", JSON.stringify(context.id))
        .replace("SRC", source);
};
