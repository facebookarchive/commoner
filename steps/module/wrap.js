exports.name = "cjs-wrap";

exports.version = 1;

exports.build = function(id, source) {
    return "install(ID,function(require,exports,module){SRC});"
        .replace("ID", JSON.stringify(id))
        .replace("SRC", source);
};
