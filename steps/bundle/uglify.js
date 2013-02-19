exports.name = "uglify";
exports.version = 3;

var minify = require("uglify-js").minify;

exports.build = function(context, source) {
    return minify(source, {
        fromString: true,
        mangle: {
            except: ["require"]
        }
    }).code;
};
