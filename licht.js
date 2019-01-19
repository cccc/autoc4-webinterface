if (typeof String.prototype.startsWith != 'function') {
    String.prototype.startsWith = function (str){
        return this.slice(0, str.length) == str;
    };
}

function register_click_handlers()
{
    $('#gate').each(function() {
        var button = $(this);
        button.click(function(ev) {
            ev.preventDefault();

            var buf = new Uint8Array(0);
            var message = new Messaging.Message(buf);
            message.destinationName = 'club/gate';
            mqtt_client.send(message);
        });
    });
    $('#shutdown').each(function() {
        var button = $(this);
        button.click(function(ev) {
            ev.preventDefault();

            var buf = new Uint8Array(0);
            var message = new Messaging.Message(buf);
            message.destinationName = 'club/shutdown';
            mqtt_client.send(message);
        });
    });
    $('#shutdown-force').each(function() {
        var button = $(this);
        button.click(function(ev) {
            ev.preventDefault();

            var buf = new Uint8Array(1);
            buf[0] = 0x44;
            var message = new Messaging.Message(buf);
            message.destinationName = 'club/shutdown';
            mqtt_client.send(message);
        });
    });
    $('div.preset-container').find('.preset-button').each(function() {
        var preset_button = $(this);
        preset_button.click(function(ev) {
            ev.preventDefault();
            send_preset(preset_button);
        });
    });
    $('div.licht-container').find('.licht-button').each(function() {
        var licht_button = $(this);
        var topic = licht_button.data('topic');
        licht_button.click(function(ev) {
            ev.preventDefault();
            var on = !licht_button.hasClass('licht-an');
            onoff(topic, on);
        });
    });
    $('div.mpd-container').each(function() {
        var container = $(this);
        var topic = container.data('topic') + '/control';
        var buttons = container.find('.mpd-button');
        buttons.click(function(ev) {
            ev.preventDefault();
            var fct = $(this).data('function');
            mpd_control(topic, fct);
        });
    });
    $('.dmx-room-container > .dmx-container > .dmx-range').each(function() {
        var slider = $(this);
        slider.input(function(ev) {
            ev.preventDefault();
            send_dmx_room_data(slider.parent());
        });
    });
    $('.dmx-detail-container > .dmx-container > .dmx-range').each(function() {
        var slider = $(this);
        slider.input(function(ev) {
            ev.preventDefault();
            send_dmx_data(slider.parent());
        });
    });
    $('.dmx-room-container > .open-close-button').each(function() {
        var button = $(this);
        button.click(function(ev) {
            ev.preventDefault();
            var c = button.parent().find('.dmx-detail-container');
            if (c.hasClass('hidden'))
            {
                c.removeClass('hidden');
                button.find('span').text('^^^');
            }
            else
            {
                c.addClass('hidden');
                button.find('span').text('v v v');
            }
        });
    });
}


var mqtt_client;

function init_mqtt_websockets() {
    //mqtt_client = new Messaging.Client(location.hostname, Number(location.port), mqtt_generate_clientid());
    //mqtt_client = new Messaging.Client(location.hostname, 9000, mqtt_generate_clientid());
    mqtt_client = new Messaging.Client('172.23.23.110', 9000, mqtt_generate_clientid());
    mqtt_client.onConnectionLost = mqtt_on_connection_lost;
    mqtt_client.onMessageArrived = mqtt_on_message_arrived;
    mqtt_client.connect({onSuccess:mqtt_on_connect, onFailure:mqtt_on_connect_failure});
}

// generate a random mqtt clientid
function mqtt_generate_clientid() {
        return 'wscl_yxxxxxxxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                        var r = Math.random()*16|0, v = c == 'x' ? r : (r&0x3|0x8);
                                return v.toString(16);
        });
};

function mqtt_on_connect_failure() {
    console.log('mqtt connect failed, retrying in 5 sec');
    setTimeout(init_mqtt_websockets, 5000);
};

function mqtt_on_connect() {
    console.log('onConnect');

    // Once a connection has been made, make subscriptions.
    mqtt_client.subscribe('licht/+/+');
    mqtt_client.subscribe('led/+/+');
    mqtt_client.subscribe('power/+/+');
    mqtt_client.subscribe('mpd/+/+');
    mqtt_client.subscribe('fenster/+/+');
    mqtt_client.subscribe('dmx/+/+');
    mqtt_client.subscribe('club/status');

    // enable buttons
    $('.shutdown-button').removeClass('disabled');
    $('.gate-button').removeClass('disabled');
    $('.preset-button').removeClass('disabled');
    $('.mpd-button').removeClass('disabled');
};

function mqtt_on_connection_lost(responseObject) {
    console.log('mqtt connection lost, reconnecting in 5 sec');
    all_unknown(); // disable buttons
    setTimeout(init_mqtt_websockets, 5000);
};

function mqtt_on_message_arrived(message) {
    if (message.destinationName.startsWith('licht/') || message.destinationName.startsWith('power/') || message.destinationName.startsWith('led/'))
    {
        // update licht-button state
        var button = $('.licht-button').filter('[data-topic="' + message.destinationName + '"]');
        if (button && message.payloadBytes[0] != 0)
            button.removeClass('licht-unknown').removeClass('licht-aus').addClass('licht-an');
        else
            button.removeClass('licht-unknown').removeClass('licht-an').addClass('licht-aus');
        return;
    }

    if (message.destinationName.startsWith('fenster/'))
    {
        // update fenster-box state
        var box = $('.fenster-box').filter('[data-topic="' + message.destinationName + '"]');
        if (message.payloadBytes[0] != 0)
            box.removeClass('fenster-unknown').removeClass('fenster-geschlossen').addClass('fenster-offen');
        else
            box.removeClass('fenster-unknown').removeClass('fenster-offen').addClass('fenster-geschlossen');
        return;
    }

    if (message.destinationName.startsWith('dmx/'))
    {
        var dmx_container = $('.dmx-container').filter('[data-topic="' + message.destinationName + '"]');
        if (message.payloadBytes.length >= 3)
        {
            // update dmx slider values
            var payloadBytes = message.payloadBytes;
            dmx_container.find('[data-color="red"]').val(payloadBytes[0]);
            dmx_container.find('[data-color="green"]').val(payloadBytes[1]);
            dmx_container.find('[data-color="blue"]').val(payloadBytes[2]);

            // update header color to match dmx value
            var header = dmx_container.find('h3');
            header.css('color', 'rgb(' + payloadBytes[0] + ',' + payloadBytes[1] + ',' + payloadBytes[2] + ')');

            var same = true;
            var detail_container = dmx_container.parent();
            detail_container.find('.dmx-range[data-color="red"]').each(function(i, e) {
                same = same && ($(e).val() == payloadBytes[0]);
            });
            detail_container.find('.dmx-range[data-color="green"]').each(function(i, e) {
                same = same && ($(e).val() == payloadBytes[1]);
            });
            detail_container.find('.dmx-range[data-color="blue"]').each(function(i, e) {
                same = same && ($(e).val() == payloadBytes[2]);
            });
            if (same)
            {
                var dmx = detail_container.parent().find('.dmx-master');
                dmx.find('[data-color="red"]').val(payloadBytes[0]);
                dmx.find('[data-color="green"]').val(payloadBytes[1]);
                dmx.find('[data-color="blue"]').val(payloadBytes[2]);
                var header = dmx.find('h2');
                header.css('color', 'rgb(' + payloadBytes[0] + ',' + payloadBytes[1] + ',' + payloadBytes[2] + ')');
            }
        }
        return;
    }

    if (message.destinationName.startsWith('mpd/'))
    {
        var index = message.destinationName.lastIndexOf('/');
        var prefix = message.destinationName.substring(0, index);
        var suffix = message.destinationName.substring(index + 1);
        var container = $('.mpd-container[data-topic="'+prefix+'"]');

        var state_box = container.find('.mpd-state');
        console.log(state_box);

        if (suffix == 'state')
        {
            state2class = {
                'play': 'playing',
                'pause': 'paused',
                'stop': 'stopped',
            }

            state_box.removeClass('state-unknown');
            state_box.removeClass('state-playing');
            state_box.removeClass('state-stopped');
            state_box.removeClass('state-paused');

            if (message.payloadString in state2class)
            {
                state_box.addClass('state-' + state2class[message.payloadString]);
            }
            else
            {
                state_box.addClass('state-unknown');
            }
        }
        else if (suffix == 'song')
        {
            state_box.text(message.payloadString);
        }
    }

    if (message.destinationName == 'club/status')
    {
        // update club status message
        var t = $('#status-box');
        if (t && message.payloadBytes[0] != 0)
            t.text('Offen');
        else
            t.text('Geschlossen');
    }
};

// publish (on ? 0x01 : 0x00) message to a topic
function onoff(topic, on) {
    var buf = new Uint8Array(1);
    buf[0] = on ? 1 : 0;
    var message = new Messaging.Message(buf);
    message.retained = true;
    message.destinationName = topic;
    mqtt_client.send(message);
};

// publish dmx rgb color + enable byte for a dmx container
function send_dmx_data(container) {
    if (container.data('variant') == '4ch')
    {
        var buf = new Uint8Array(4);
        buf[0] = container.find('[data-color="red"]').val();
        buf[1] = container.find('[data-color="green"]').val();
        buf[2] = container.find('[data-color="blue"]').val();
        buf[3] = 255;
    }
    else if (container.data('variant') == '7ch')
    {
        var buf = new Uint8Array(7);
        buf[0] = container.find('[data-color="red"]').val();
        buf[1] = container.find('[data-color="green"]').val();
        buf[2] = container.find('[data-color="blue"]').val();
        buf[3] = 0;
        buf[4] = 0;
        buf[5] = 0;
        buf[6] = 255; // full brightness
    }
    var message = new Messaging.Message(buf);
    message.retained = true;
    message.destinationName = container.data('topic');
    mqtt_client.send(message);
};
// publish dmx rgb color + enable byte for a dmx room container
// actually publishes the value off the room slider for all sub dmx-containers
function send_dmx_room_data(container) {
    send_dmx_data(container);
    //container.parent().find('.dmx-detail-container > .dmx-container').each(function () {
    //    $(this).find('[data-color="red"]').val(container.find('[data-color="red"]').val());
    //    $(this).find('[data-color="green"]').val(container.find('[data-color="green"]').val());
    //    $(this).find('[data-color="blue"]').val(container.find('[data-color="blue"]').val());
    //    send_dmx_data($(this));
    //});
};
function send_preset(preset_button) {
    var topic = preset_button.data('topic');
    var buf = new Uint8Array(0);
    var message = new Messaging.Message(buf);
    message.destinationName = topic;
    mqtt_client.send(message);
}

function mpd_control(topic, fct) {
    var message = new Messaging.Message(fct);
    message.retained = false;
    message.destinationName = topic;
    mqtt_client.send(message);
}

// disable all controls
function all_unknown() {
    $('.licht-button').addClass('licht-unknown');
    $('.fenster-box').addClass('fenster-unknown');
    $('.shutdown-button').addClass('disabled');
    $('.gate-button').addClass('disabled');
    $('.preset-button').addClass('disabled');
    $('.mpd-button').addClass('disabled');
};

register_click_handlers();
init_mqtt_websockets();
