function myassert(test, msg) {
    if (!test) {
        throw new Error(msg);
    }
}

module.exports = myassert.ok = myassert;
