function padInt(i, wanted_length) {
    var topad = wanted_length - ("" + i).length;
    for (var j=0; j<topad; j++)
        i = "0" + i;
    return i;
}

// from stackoverflow:
function startTime() {
    var today = new Date();
    var h = today.getHours();
    var m = today.getMinutes();
    var s = today.getSeconds();
    var d = today.getDay();
    var month = today.getMonth() + 1;
    var y = today.getFullYear();
    h = padInt(h, 2);
    m = padInt(m, 2);
    s = padInt(s, 2);
    d = padInt(d, 2);
    y = padInt(y, 2);
    month = padInt(month, 2);
    document.getElementById('time-box').innerHTML = h + ":" + m + ":" + s + " " + d + "-" + month + "-" + y;
    t = setTimeout(function () {
        startTime()
    }, 500);
}
startTime();
