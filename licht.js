'use strict';

// TODOs
// - disable dmx power buttons?

if (typeof String.prototype.startsWith != 'function') {
    String.prototype.startsWith = function (str){
        return this.slice(0, str.length) == str;
    };
}

function rgbToHex(r, g, b) {
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

class GeneralController {

    constructor() {
    }

    on_load() {
        this.register_events();
    }

    on_connect() {
        mqtt_controller.mqtt_client.subscribe('licht/+/+');
        mqtt_controller.mqtt_client.subscribe('relais/+/+');
        mqtt_controller.mqtt_client.subscribe('socket/+/+');
        mqtt_controller.mqtt_client.subscribe('led/+/+');
        mqtt_controller.mqtt_client.subscribe('power/+/+');
        mqtt_controller.mqtt_client.subscribe('fenster/+/+');
        mqtt_controller.mqtt_client.subscribe('club/status');

        document.querySelectorAll('.shutdown-button').forEach(button => { button.classList.remove('disabled') });
        document.querySelectorAll('.gate-button').forEach(button => { button.classList.remove('disabled') });
        document.querySelectorAll('.roompreset-button').forEach(button => { button.classList.remove('disabled') });
    }

    on_disconnect() {
        document.querySelectorAll('.licht-button').forEach(button => { button.classList.add('licht-unknown'); });
        document.querySelectorAll('.fenster-box').forEach(box => { box.classList.add('fenster-unknown'); });
        document.querySelectorAll('.shutdown-button').forEach(button => { button.classList.add('disabled'); });
        document.querySelectorAll('.gate-button').forEach(button => { button.classList.add('disabled'); });
        document.querySelectorAll('.roompreset-button').forEach(button => { button.classList.add('disabled'); });
    }

    on_message(message) {
        if (message.destinationName.startsWith('licht/') || message.destinationName.startsWith('power/') || message.destinationName.startsWith('led/') || message.destinationName.startsWith('relais/') || message.destinationName.startsWith('socket/')) {
            if (message.payloadBytes.length != 1)
                return;

            // update licht-button state
            document.querySelectorAll(`.licht-button[data-topic="${message.destinationName}"]`).forEach(button => {
                if (message.payloadBytes[0] != 0) {
                    button.classList.remove('licht-unknown');
                    button.classList.remove('licht-aus');
                    button.classList.add('licht-an');
                } else {
                    button.classList.remove('licht-unknown');
                    button.classList.remove('licht-an');
                    button.classList.add('licht-aus');
                }
            });
            return;
        }

        if (message.destinationName.startsWith('fenster/')) {
            if (message.payloadBytes.length != 1)
                return;

            // update fenster-box state
            document.querySelectorAll(`.fenster-box[data-topic="${message.destinationName}"]`).forEach(box => {
                if (message.payloadBytes[0] != 0) {
                    box.classList.remove('fenster-unknown');
                    box.classList.remove('fenster-geschlossen');
                    box.classList.add('fenster-offen');
                } else {
                    box.classList.remove('fenster-unknown');
                    box.classList.remove('fenster-offen');
                    box.classList.add('fenster-geschlossen');
                }
            });
            return;
        }

        if (message.destinationName == 'club/status') {
            if (message.payloadBytes.length != 1)
                return;

            // update club status message
            const t = document.getElementById('status-box');
            if (message.payloadBytes[0] != 0)
                t.textContent = 'Offen';
            else
                t.textContent = 'Geschlossen';
        }
    }

    register_events() {

        document.addEventListener('keydown', function(event) {
            if(event.keyCode == 27) {
                dmx_controller.close_popup(true);
                functions_controller.close_popup();
            }
        });

        const content_container = document.getElementById('content');

        {
            const button = document.getElementById('gate');
            button.addEventListener('click', event => {
                event.preventDefault();

                const buf = new Uint8Array(0);
                const message = new Messaging.Message(buf);
                message.destinationName = 'club/gate';
                mqtt_controller.mqtt_client.send(message);
            });
        }
        {
            const button = document.getElementById('shutdown');
            button.addEventListener('click', event => {
                event.preventDefault();

                const buf = new Uint8Array(0);
                const message = new Messaging.Message(buf);
                message.destinationName = 'club/shutdown';
                mqtt_controller.mqtt_client.send(message);
            });
        }
        {
            const button = document.getElementById('shutdown-force');
            button.addEventListener('click', event => {
                event.preventDefault();

                const buf = new Uint8Array(1);
                buf[0] = 0x44;
                const message = new Messaging.Message(buf);
                message.destinationName = 'club/shutdown';
                mqtt_controller.mqtt_client.send(message);
            });
        }
        content_container.querySelectorAll('div.roomfunc-container .roompreset-button').forEach(roompreset_button => {
            roompreset_button.addEventListener('click', event => {
                event.preventDefault();
                this.send_roompreset(roompreset_button);
            });
        });
        content_container.querySelectorAll('div.licht-container .licht-button').forEach(licht_button => {
            licht_button.addEventListener('click', event => {
                event.preventDefault();
                const topic = licht_button.dataset.topic;
                const on = !licht_button.classList.contains('licht-an');
                GeneralController.onoff(topic, on);
            });
        });
    }

    // publish (on ? 0x01 : 0x00) message to a topic
    static onoff(topic, on) {
        const buf = new Uint8Array(1);
        buf[0] = on ? 1 : 0;
        const message = new Messaging.Message(buf);
        message.retained = true;
        message.destinationName = topic;
        mqtt_controller.mqtt_client.send(message);
    }

    send_roompreset(roompreset_button) {
        const topic = roompreset_button.dataset.topic;
        const buf = new Uint8Array(0);
        const message = new Messaging.Message(buf);
        message.destinationName = topic;
        mqtt_controller.mqtt_client.send(message);
    }
}

class DmxWidget {

    // This class is just a bundler for dmx widget logic and can be
    // instantiated at any time for any dmx widget in the DOM. As such it must
    // not store any state directly, but rather in the DOM objects themselves.

    constructor(container) {
        this.container = container;
    }

    is_master() {
        return this.container.classList.contains('dmx-master');
    }

    // return color data this widget has according to mqtt data
    // might contain undefined values
    get_color_data(truncate_colors=true) {
        const topic = this.container.dataset.topic;

        if (!dmx_controller.topics_data.has(topic))
            dmx_controller.topics_data.set(topic, [undefined, undefined, undefined, undefined]);

        const saved_data = dmx_controller.topics_data.get(topic);

        if (!truncate_colors)
            return saved_data;

        if (this.container.dataset.variant != 'rgbw')
            return saved_data.slice(0, 3);
        else
            return saved_data.slice(0, 4);
    }

    is_non_color() {
        if (this.container.dataset.variant != '7ch')
            return false;

        const topic = this.container.dataset.topic;

        if (!dmx_controller.topics_data.has(topic))
            return false;

        const saved_data = dmx_controller.topics_data.get(topic);

        if (saved_data[3] != 0 || saved_data[4] != 0 || saved_data[5] != 0)
            return true;
        return false;
    }

    is_off() {
        return this.get_color_data().every(c => c==0);
    }

    // return the coressponding master widget for this one
    // might return null if there is none
    get_master_widget() {
        if (this.is_master())
            return this;

        const detail_container = this.container.parentElement;
        const master = detail_container.previousElementSibling;

        if (!master)
            return null;

        if (!master.classList.contains('dmx-master'))
            return null;

        return new DmxWidget(master);
    }

    // returns an array of child widgets, if this is a master widget
    // otherwise returns null
    get_child_widgets() {
        if (!this.is_master())
            return null;

        const detail_container = this.container.nextElementSibling;

        if (!detail_container.classList.contains('dmx-detail-container')) {
            console.log('dmx-detail-container not found');
            return null;
        }

        return Array.from(detail_container.querySelectorAll('.dmx-container'), container => new DmxWidget(container));
    }

    // update control elements (input elements, color window, etc) with the
    // current color values taken from mqtt data
    update_controls() {
        if (this.is_master())
            return;

        const color_data = this.get_color_data(false);

        // update color window
        const color_win = this.container.querySelector('.dmx-color-window');
        if (color_win) {
            if (this.is_non_color()) {
                color_win.classList.add('invalid-color');
            } else {
                color_win.classList.remove('invalid-color');
                if (this.container.dataset.variant == 'rgbw' &&
                    color_data[0] == 0 &&
                    color_data[1] == 0 &&
                    color_data[2] == 0
                )
                    color_win.style.backgroundColor = rgbToHex(color_data[3],color_data[3],  color_data[3]);
                else
                    color_win.style.backgroundColor = rgbToHex(color_data[0],color_data[1],  color_data[2]);
            }
        }

        // update color sliders
        this.container.querySelectorAll('[data-color="red"]').forEach(range => { range.value = color_data[0]; });
        this.container.querySelectorAll('[data-color="green"]').forEach(range => { range.value = color_data[1]; });
        this.container.querySelectorAll('[data-color="blue"]').forEach(range => { range.value = color_data[2]; });
        if (this.container.dataset.variant == 'rgbw')
            this.container.querySelectorAll('[data-color="white"]').forEach(range => { range.value = color_data[3]; });

        // // update header color to match dmx value
        // const header = this.container.querySelector('h3,h2');
        // header.style.color = 'rgb(' + payloadBytes[0] + ',' + payloadBytes[1] + ',' + payloadBytes[2] + ')';

        // update functions parameters
        if (this.container.dataset.variant == '7ch' && color_data[5] != 0) {
            let fct = undefined;
            if (0x80 <= color_data[5] && color_data[5] <= 0x9f) fct = 'fade';
            if (0xa0 <= color_data[5] && color_data[5] <= 0xbf) fct = 'flash'; // actually flash-less, but handle the same
            if (0xc0 <= color_data[5] && color_data[5] <= 0xdf) fct = 'flash';
            if (0xe0 <= color_data[5] && color_data[5] <= 0xff) fct = 'sound-active';
            const range = this.container.querySelector(`.dmx-range[data-function="${fct}"]`);
            if (range)
                range.value = color_data[4];
        }
    }

    update_master_controls() {
        // TODO better white channel handling?
        const same = [true, true, true, true];
        let any_non_color = false;

        // check for differing color data
        const all_children = this.get_child_widgets();
        const comparison_color_data = [undefined, undefined, undefined, undefined];

        all_children.forEach(w => {
            if (w.is_master())
                return;
            if (w.is_non_color())
                any_non_color = true;
            const w_color_data = w.get_color_data();
            for (let i=0; i<4; i++) {
                if (comparison_color_data[i] == undefined)
                    comparison_color_data[i] = w_color_data[i];
                same[i] = same[i] && ((w_color_data[i] == comparison_color_data[i]) || w_color_data[i] == undefined)
            }
        });

        // update UI
        const color_win = this.container.querySelector('.dmx-color-window');
        if (same[0]) this.container.querySelectorAll('[data-color="red"]').forEach(range => { range.value = comparison_color_data[0]; });
        if (same[1]) this.container.querySelectorAll('[data-color="green"]').forEach(range => { range.value = comparison_color_data[1]; });
        if (same[2]) this.container.querySelectorAll('[data-color="blue"]').forEach(range => { range.value = comparison_color_data[2]; });
        if (same[3]) this.container.querySelectorAll('[data-color="white"]').forEach(range => { range.value = comparison_color_data[3]; });
        if (same[0] && same[1] && same[2] && same[3] && !any_non_color) {
            if (color_win) {
                if (comparison_color_data[3] != undefined &&
                    comparison_color_data[0] == 0 &&
                    comparison_color_data[1] == 0 &&
                    comparison_color_data[2] == 0
                )
                    color_win.style.backgroundColor = rgbToHex(
                        comparison_color_data[3],
                        comparison_color_data[3],
                        comparison_color_data[3],
                    );
                else
                    color_win.style.backgroundColor = rgbToHex(
                        comparison_color_data[0],
                        comparison_color_data[1],
                        comparison_color_data[2],
                    );
                color_win.classList.remove('invalid-color');
            }
        } else {
            if (color_win) {
                color_win.classList.add('invalid-color');
            }
        }
    }

    send_white() {
        if (this.container.dataset.variant == 'rgbw')
            this.send_data([0, 0, 0, 255]);
        else
            this.send_data([255, 255, 255, 0]);
    }

    // read values from ui controls and send this data
    send_ui_data() {
        const colors = [0, 0, 0, 0];
        colors[0] = this.container.querySelector('[data-color="red"]').value;
        colors[1] = this.container.querySelector('[data-color="green"]').value;
        colors[2] = this.container.querySelector('[data-color="blue"]').value;
        const range_white = this.container.querySelector('[data-color="white"]');
        if (range_white)
            colors[3] = range_white.value;

        this.send_data(colors);
    }

    send_single_color_change(color_index, color_value) {
        const colors = this.get_color_data();
        colors[color_index] = color_value;
        this.send_data(colors);
    }

    // publish dmx rgb color + enable byte for a dmx container
    send_data(colors) {
        const ncolors = Array.from(colors, x => (x == undefined ? 0 : x))

        let buf;
        switch (this.container.dataset.variant) {

            case '4ch':
                buf = new Uint8Array(4);
                buf[0] = ncolors[0];
                buf[1] = ncolors[1];
                buf[2] = ncolors[2];
                buf[3] = 255;
                break;

            case '7ch':
                buf = new Uint8Array(7);
                buf[0] = ncolors[0];
                buf[1] = ncolors[1];
                buf[2] = ncolors[2];
                buf[3] = 0;
                buf[4] = 0;
                buf[5] = 0;
                buf[6] = 255; // full brightness
                break;

            case 'rgb':
                buf = new Uint8Array(3);
                buf[0] = ncolors[0];
                buf[1] = ncolors[1];
                buf[2] = ncolors[2];
                break;

            case 'rgbw':
                buf = new Uint8Array(4);
                buf[0] = ncolors[0];
                buf[1] = ncolors[1];
                buf[2] = ncolors[2];
                buf[3] = ncolors[3];
                break;

            default:
                return;

        }
        const message = new Messaging.Message(buf);
        message.retained = true;
        message.destinationName = this.container.dataset.topic;
        // console.log(`sending ${message.destinationName} ${message.payloadBytes}`)
        mqtt_controller.mqtt_client.send(message);
    }

    send_function(fct, param) {
        if (this.container.dataset.variant != '7ch')
            return;

        let fct_value;
        switch (fct) {
            case 'fade': fct_value = 0x81; break;
            case 'flash-less': fct_value = 0xa1; break;
            case 'flash': fct_value = 0xc1; break; // more colors
            case 'sound-active': fct_value = 0xe1; break;
            default: fct_value = 0; break;
        }

        const buf = new Uint8Array(7);
        buf[0] = 0;
        buf[1] = 0;
        buf[2] = 0;
        buf[3] = 0;
        buf[4] = param; // speed / sensitivity
        buf[5] = fct_value;
        buf[6] = 255;

        const message = new Messaging.Message(buf);
        message.retained = true;
        message.destinationName = this.container.dataset.topic;
        console.log(buf);
        console.log(message.destinationName);
        mqtt_controller.mqtt_client.send(message);
    }


    // Expanding / collapsing

    expand() {
        this.container.classList.add('show-buttons');
        this.container.classList.add('show-colors');
    }

    collapse() {
        this.container.classList.remove('show-buttons');
        this.container.classList.remove('show-colors');
    }

    is_expanded() {
        return this.container.classList.contains('show-buttons') || this.container.classList.contains('show-colors');
    }

    toggle_expand() {
        if (this.is_expanded())
            this.collapse();
        else
            this.expand();
    }


    // Widget selection (for dmx popup) logic

    is_selected() {
        return this.container.classList.contains('selected');
    }

    toggle_selected() {
        this.set_selected(!this.is_selected());
    }

    set_selected(new_state) {
        if (new_state) {
            this.container.classList.add('selected');
        } else {
            this.container.classList.remove('selected');
        }

        const input = this.container.querySelector('input.dmx-checkbox');
        if (input)
            input.checked = new_state;
    }

    // after own selected status has changed, update status of corresponding master widget
    update_master_select() {

        const master = this.get_master_widget();
        if (!master)
            return;

        let all_selected = true;
        let all_unselected = true;

        const children = master.get_child_widgets();
        children.forEach(w => {
            if (w.is_selected())
                all_unselected = false;
            else
                all_selected = false;
        });

        master.set_selected(all_selected);
    }

    // if this is a master widget and the selected status has changed, update status of all children
    master_select_update_children() {
        const new_state = this.is_selected();

        this.get_child_widgets().forEach(w => {
            w.set_selected(new_state);
        });
    }

    update_for_global_selecting_state(state) {
        if (state) {
            this.container.classList.add('show-selecting');
        } else {
            this.container.classList.remove('show-selecting');
        }
    }


    // Events

    register_events() {
        this.container.querySelectorAll('.dmx-checkbox').forEach(box => {
            box.addEventListener('input', event => {
                event.preventDefault();
                if (this.is_master()) {
                    this.set_selected(box.checked);
                    this.master_select_update_children();
                    dmx_controller.update_selecting_state();
                } else {
                    this.set_selected(box.checked);
                    this.update_master_select();
                    dmx_controller.update_selecting_state();
                }
            });
        });
        this.container.querySelectorAll('.dmx-name').forEach(box => {
            box.addEventListener('click', event => {
                event.preventDefault();
                if (dmx_controller.is_selecting()) {
                    if (this.is_master())
                        this.button_master_action('select');
                    else
                        this.button_action('select');
                } else {
                    this.toggle_expand();
                }
            });
        });
        this.container.querySelectorAll('.dmx-color-window').forEach(box => {
            box.addEventListener('click', event => {
                event.preventDefault();
                if (dmx_controller.is_selecting()) {
                    if (this.is_master())
                        this.button_master_action('open');
                    else
                        this.button_action('open');
                } else {
                    this.toggle_expand();
                }
            });
        });
        this.container.querySelectorAll('.dmx-range').forEach(slider => {
            slider.addEventListener('input', event => {
                event.preventDefault();
                this.slider_event(slider);
            });
        });
        this.container.querySelectorAll('.dmx-control-button').forEach(btn => {
            btn.addEventListener('click', event => {
                event.preventDefault();
                this.button_event(btn);
            });
        });
        this.container.querySelectorAll('.power-button').forEach(btn => {
            btn.addEventListener('click', event => {
                event.preventDefault();
                this.button_event(btn);
            });
        });
    }

    slider_event(slider) {

        let index;
        switch (slider.dataset.color) {
            case 'red': index = 0; break;
            case 'green': index = 1; break;
            case 'blue': index = 2; break;
            case 'white': index = 3; break;
            default: return;
        }

        if (this.is_master()) {
            this.get_child_widgets().forEach(w => {
                w.send_single_color_change(index, slider.value);
            });
        } else {
            this.send_ui_data();
        }
    }

    button_event(btn) {
        const action = btn.dataset.action;

        if (this.is_master())
            this.button_master_action(action);
        else
            this.button_action(action);
    }

    button_master_action(action) {
        switch (action) {
            case 'select':
                this.toggle_selected();
                this.master_select_update_children();
                dmx_controller.update_selecting_state();
                break;

            case 'open':
                if (!dmx_controller.is_selecting()) {
                    this.button_master_action('select');
                }
                dmx_controller.open_popup();
                break;

            case 'power':
                if (this.get_child_widgets().every(w => w.is_off()))
                    action = 'white';
                else
                    action = 'off';
                this.get_child_widgets().forEach(w => w.button_action(action));
                break;

            case 'fade':
            case 'flash':
            case 'sound-active': {
                const range = this.container.querySelector(`.dmx-range[data-function="${action}"]`);
                const param = range ? range.value : 0;
                this.get_child_widgets().forEach(w => w.send_function(action, param));
                break;
            }

            default:
                this.get_child_widgets().forEach(w => w.button_action(action));
        }
    }

    button_action(action) {
        switch (action) {
            case 'white':
                this.send_white();
                break;

            case 'off':
                this.send_data([0, 0, 0, 0]);
                break;

            case 'power':
                if (this.is_off())
                    this.send_white();
                else
                    this.send_data([0, 0, 0, 0]);
                break;

            case 'select':
                this.toggle_selected();
                this.update_master_select();
                dmx_controller.update_selecting_state();
                break;

            case 'open':
                if (!dmx_controller.is_selecting()) {
                    this.button_action('select');
                }
                dmx_controller.open_popup();
                break;

            case 'fade':
            case 'flash':
            case 'sound-active': {
                const range = this.container.querySelector(`.dmx-range[data-function="${action}"]`);
                const param = range ? range.value : 0;
                this.send_function(action, param);
                break;
            }

            default:
                return;
        }
    }
}

class DmxController {

    constructor() {
        this.popup_data = {};
        this.topics_data = new Map();
        this.selecting_state = false;

        // reset checkboxes, their state is kept through refreshs
        document.getElementById('content').querySelectorAll('.dmx-container .dmx-checkbox').forEach(box => {
            box.checked = false;
        });
    }

    on_load() {
        this.register_events();
    }

    on_connect() {
        mqtt_controller.mqtt_client.subscribe('dmx/+/+');
        document.querySelectorAll('.dmx-control-button').forEach(button => { button.classList.remove('disabled') });
    }

    on_disconnect() {
        document.querySelectorAll('.dmx-control-button').forEach(button => { button.classList.add('disabled'); });
    }

    on_message(message) {
        if (!message.destinationName.startsWith('dmx/'))
            return false;

        if (message.payloadBytes.length < 3)
            return false;

        this.topics_data.set(message.destinationName, message.payloadBytes);

        document.querySelectorAll(`.dmx-container[data-topic="${message.destinationName}"]`).forEach(dmx_container => {

            const widget = new DmxWidget(dmx_container);

            if (widget.is_master())
                return;

            // update control ui
            widget.update_controls();

            // (potentially) update master control ui
            const master = widget.get_master_widget();
            if (master)
                master.update_master_controls();
        });

        return true;
    }

    register_events() {
        const dmx_popup = document.getElementById('dmx-popup');
        const content_container = document.getElementById('content');

        content_container.querySelectorAll('.dmx-container').forEach(ctr => {
            const w = new DmxWidget(ctr);
            w.register_events();
        });
        dmx_popup.querySelectorAll('.dmx-container').forEach(ctr => {
            const w = new DmxWidget(ctr);
            w.register_events();
        });

        content_container.querySelectorAll('.dmx-room-container > .open-close-button').forEach(button => {
            button.addEventListener('click', event => {
                event.preventDefault();
                button.parentElement.querySelectorAll('.dmx-detail-container').forEach(c => {
                    if (c.classList.contains('hidden')) {
                        c.classList.remove('hidden');
                        button.querySelector('span').textContent = '^^^';
                    } else {
                        c.classList.add('hidden');
                        button.querySelector('span').textContent = 'v v v';
                    }
                });
            });
        });

        dmx_popup.addEventListener('click', event => {
            // somewhere within popup overlay element has been clicked, if target is the
            // overlay itself (ie. not any child element), then close the popup
            if (event.target != dmx_popup)
                return;
            event.preventDefault();
            this.close_popup(true);
        });
        dmx_popup.querySelector('.popup-close-button').addEventListener('click', event => {
            event.preventDefault();
            this.close_popup(true);
        });
    }

    is_selecting() {
        return this.selecting_state;
    }

    update_selecting_state() {
        const new_state = (document.getElementById('content').querySelector('.dmx-container.selected')) != null;

        if (new_state != this.selecting_state) {
            this.selecting_state = new_state;
            document.getElementById('content').querySelectorAll('.dmx-container').forEach(ctr => {
                const w = new DmxWidget(ctr);
                w.update_for_global_selecting_state(new_state);
            });
        }
    }

    open_popup() {
        const popup_element = document.getElementById('dmx-popup');
        const selected_containers = document.querySelectorAll('.dmx-container.selected:not(.dmx-master)');

        const variants = new Set();
        selected_containers.forEach(ctr => {
            variants.add(ctr.dataset.variant);
        });

        let changing = '';
        changing = Array.from(selected_containers, ctr => ctr.querySelector('.dmx-name').textContent).join(', ');
        popup_element.querySelector('.changing').textContent = changing;

        const show_white_channel = variants.has('rgbw');
        const show_functions = variants.has('7ch');

        if (show_white_channel)
            popup_element.querySelector('.dmx-range[data-color="white"]').classList.remove('hidden');
        else
            popup_element.querySelector('.dmx-range[data-color="white"]').classList.add('hidden');

        const single_ctr = popup_element.querySelector('.popup-singles');
        let new_content = '';
        selected_containers.forEach(ctr => {
            let lookup = ctr.dataset.variant;
            if (lookup == '4ch')
                lookup = 'rgb';
            let template = document.getElementById(`template-dmx-${lookup}`).innerHTML;
            const text = ctr.querySelector('.dmx-name').textContent;
            template = template.replace('{ text }', text);
            template = template.replace('{ topic }', ctr.dataset.topic);
            template = template.replace('{ variant }', ctr.dataset.variant);
            new_content += template;
        });
        single_ctr.innerHTML = new_content;

        // set initial color and register event handlers
        const master_widget = new DmxWidget(popup_element.querySelector('.dmx-master'));
        master_widget.update_master_controls();
        single_ctr.querySelectorAll('.dmx-container').forEach(ctr => {
            const w = new DmxWidget(ctr);
            w.update_controls();
            w.register_events();
            if (mqtt_controller.is_connected()) {
                ctr.querySelectorAll('.dmx-control-button').forEach(button => { button.classList.remove('disabled') });
            }
        });

        popup_element.classList.add('show');
        this.popup_data.selected_containers = selected_containers;
        this.popup_data.variants = variants;
    }

    close_popup(deselect=true) {
        if (deselect) {
            if (this.popup_data.selected_containers != undefined)
                this.popup_data.selected_containers.forEach(ctr => {
                    const w = new DmxWidget(ctr);
                    w.set_selected(false);
                    w.update_master_select();
                });
            this.update_selecting_state();
        }
        document.getElementById('dmx-popup').classList.remove('show');
    }
}

class MpdController {

    constructor() {
    }

    on_load() {
        this.register_events();
    }

    on_connect() {
        mqtt_controller.mqtt_client.subscribe('mpd/+/+');
        document.querySelectorAll('.mpd-button').forEach(button => { button.classList.remove('disabled') });
    }

    on_disconnect() {
        document.querySelectorAll('.mpd-button').forEach(button => { button.classList.add('disabled'); });
    }

    on_message(message) {
        if (!message.destinationName.startsWith('mpd/'))
            return false;

        const index = message.destinationName.lastIndexOf('/');
        const prefix = message.destinationName.substring(0, index);
        const suffix = message.destinationName.substring(index + 1);

        document.querySelectorAll(`.mpd-container[data-topic="${prefix}"]`).forEach(container => {

            const state_box = container.querySelector('.mpd-state');

            if (suffix == 'state') {
                const state2class = {
                    'play': 'playing',
                    'pause': 'paused',
                    'stop': 'stopped',
                };

                state_box.classList.remove('state-unknown');
                state_box.classList.remove('state-playing');
                state_box.classList.remove('state-stopped');
                state_box.classList.remove('state-paused');

                if (message.payloadString in state2class) {
                    state_box.classList.add('state-' + state2class[message.payloadString]);
                } else {
                    state_box.classList.add('state-unknown');
                }
            } else if (suffix == 'song') {
                state_box.textContent = message.payloadString;
            }
        });
    }

    register_events() {
        const content_container = document.getElementById('content');
        content_container.querySelectorAll('div.mpd-container').forEach(container => {
            container.querySelectorAll('.mpd-button').forEach(button => {
                button.addEventListener('click', event => {
                    event.preventDefault();
                    const topic = container.dataset.topic + '/control';
                    const fct = button.dataset.function;
                    this.mpd_control(topic, fct);
                });
            });
        });
    }

    mpd_control(topic, fct) {
        const message = new Messaging.Message(fct);
        message.retained = false;
        message.destinationName = topic;
        mqtt_controller.mqtt_client.send(message);
    }
}

class InfrastructureController {

    constructor() {
        this.container = document.getElementById('infrastructure-container');
    }

    on_load() {
        this.register_events();
    }

    on_connect() {
        mqtt_controller.mqtt_client.subscribe('heartbeat/#');
    }

    on_disconnect() {
    }

    on_message(message) {
        if (!message.destinationName.startsWith('heartbeat/'))
            return false;

        // update infrastructure status
        const node_name = message.destinationName.substring(10);
        this.update_heartbeat_status(node_name, message.payloadBytes)
    }

    register_events() {
    }

    update_heartbeat_status(node_name, status_payload)
    {
        const ul = this.container.children[1];
        const t = Array.from(ul.children).filter(c => c.textContent == node_name);
        let res = t.length == 0 ? null : t[0];

        if (res == null)
        {
            const items = Array.from(ul.children);

            const new_node = document.createElement('li');
            new_node.textContent = node_name;
            res = new_node;

            if (items.length == 0) {
                ul.appendChild(new_node);
            } else {
                const bigger_items = items.filter(element => node_name < element.textContent);

                if (bigger_items.length == 0) {
                    ul.appendChild(new_node);
                } else {
                    ul.insertBefore(new_node, bigger_items[0]);
                }
            }
        }

        if (status_payload.length == 0) {
            res.remove();
        } else if (status_payload[0] != 0) {
            res.classList.remove('unknown');
            res.classList.add('alive');
            res.classList.remove('dead');
        } else {
            res.classList.remove('unknown');
            res.classList.add('dead');
            res.classList.remove('alive');
        }
    }
}

class FunctionsController {

    room_name_map = {
        'plenar': 'Plenarsaal',
        'wohnzimmer': 'Wohnzimmer',
        'keller': 'Keller',
        'fnordcenter': 'Fnordcenter',
        'global': 'Global',
    }

    constructor() {
        this.popup_element = document.getElementById('functions-popup');
        this.room = undefined;
    }

    on_load() {
        this.register_events();
    }

    on_connect() {
    }

    on_disconnect() {
    }

    on_message(message) {
    }

    register_events() {

        document.querySelectorAll('div.roomfunc-container .function-button').forEach(function_button => {
            function_button.addEventListener('click', event => {
                event.preventDefault();
                this.open_popup(function_button.dataset.room);
            });
        });

        this.popup_element.addEventListener('click', event => {
            // somewhere within popup overlay element has been clicked, if target is the
            // overlay itself (ie. not any child element), then close the popup
            if (event.target != this.popup_element)
                return;
            event.preventDefault();
            this.close_popup();
        });
        this.popup_element.querySelector('.popup-close-button').addEventListener('click', event => {
            event.preventDefault();
            this.close_popup();
        });
        this.popup_element.querySelectorAll('ul.tabbar > li.tab-button').forEach(button => {
            button.addEventListener('click', event => {
                event.preventDefault();
                this.on_tab_button_press(button);
                this.fire_on_show();
            });
        });
    }

    get_tabs_for_room(room) {
        const tabs_for_room = new Map(Object.entries({
            // 'wohnzimmer': Array.from(['presets', 'kitchenlight']),
            'wohnzimmer': Array.from(['presets', 'busleiste']),
            'plenar': Array.from(['presets', 'media']),
        }));
        return tabs_for_room.has(room) ? tabs_for_room.get(room) : ['presets'];
    }

    open_popup(room='global') {
        this.room = room;

        // show only relevant tabs for this room
        const tabs = this.get_tabs_for_room(room);
        this.popup_element.querySelectorAll('ul.tabbar > li.tab-button').forEach(button => {
            if (tabs.includes(button.dataset.tab))
                button.classList.remove('hidden');
            else
                button.classList.add('hidden');
        });

        // select a tab if none is selected
        const visible_buttons = Array.from(this.popup_element.querySelectorAll('ul.tabbar > li.tab-button:not(.hidden)'));
        if (visible_buttons.every(button => !button.classList.contains('selected'))) {
            this.on_tab_button_press(visible_buttons[0]);
        }

        // set room title
        this.popup_element.querySelector('ul.tabbar > li.room-name').textContent = this.room_name_map[room];

        this.fire_on_show();
        this.popup_element.classList.add('show');
    }

    on_tab_button_press(button) {
        if (button.classList.contains('selected'))
            return;

        Array.from(button.parentElement.children).forEach(c => { c.classList.remove('selected') });
        button.classList.add('selected');
        document.getElementById('functions-popup').querySelectorAll('.tab-content').forEach(t => { t.classList.remove('show') });
        document.getElementById('functions-popup').querySelector(`.tab-content.tab-${button.dataset.tab}`).classList.add('show');
    }

    close_popup() {
        this.popup_element.classList.remove('show');
    }

    fire_on_show() {
        const s = this.popup_element.querySelector('ul.tabbar > li.selected');
        if (!s)
            return;
        switch (s.dataset.tab) {
            case "presets": preset_controller.on_show();
                break;
            case "media": media_controller.on_show();
                break;
            case "busleiste": busleiste_controller.on_show();
                break;
        }
    }
}

class PresetController {

    constructor() {
        this.preset_tab = document.querySelector('#functions-popup .tab-content.tab-presets');
        this.presets = new Map();
    }

    on_load() {
        this.register_events();
    }

    on_connect() {
        mqtt_controller.mqtt_client.subscribe('preset/list');
        mqtt_controller.mqtt_client.subscribe('preset/+/list');
    }

    on_disconnect() {
    }

    on_message(message) {
        if (!message.destinationName.startsWith('preset/'))
            return false;

        let room = message.destinationName.split('/')[1];
        if (room == 'list')
            room = 'global';

        this.presets[room] = JSON.parse(message.payloadString)
        this.update_buttons(room);

        return true;
    }

    register_events() {
    }

    on_show() {
        const room = functions_controller.room;
        this.update_buttons(room);
    }

    update_buttons(room) {
        if (functions_controller.room != room)
            return;

        const container = document.querySelector('.tab-content.tab-presets');
        const frag = new DocumentFragment();

        if (this.presets[room])
            this.presets[room].forEach(preset => {
                const new_node = document.createElement('div');
                new_node.classList.add('preset-button');
                new_node.dataset.name = preset;
                new_node.dataset.room = room;
                const span_node = document.createElement('span');
                span_node.textContent = preset;
                new_node.appendChild(span_node);
                frag.appendChild(new_node);
            });

        container.replaceChildren(frag);

        // register click events
        this.preset_tab.querySelectorAll('.preset-button').forEach(button => {
            button.addEventListener('click', event => {
                event.preventDefault();
                this.send_preset(button);
            });
        });
    }

    send_preset(button) {
        const preset_name = button.dataset.name;
        const room_name = button.dataset.room;
        const topic = room_name == 'global' ? 'preset/set' : 'preset/'+room_name+'/set';
        const message = new Messaging.Message(preset_name);
        message.destinationName = topic;
        mqtt_controller.mqtt_client.send(message);
    }
}

class MediaController {

    constructor() {
        this.container = document.querySelector('.tab-content.tab-media');
        this.beamer_container = this.container.querySelector('.beamer-container');
        this.atem_container = this.container.querySelector('.atem-container');
        this.atem_content = this.atem_container.querySelector('.atem-content');
        this.active_source = undefined;
        this.active_preview = undefined;
        this.active_output = undefined;
    }

    on_load() {
        this.register_events();
    }

    on_connect() {
        mqtt_controller.mqtt_client.subscribe('beamer/plenar/lamp_state');
        mqtt_controller.mqtt_client.subscribe('atem/plenarsaal/#');

        this.beamer_container.querySelectorAll('.beamer-button').forEach(button => button.classList.remove('disabled'));
    }

    on_disconnect() {
        this.beamer_container.classList.remove('online');
        this.beamer_container.classList.remove('offline');
        this.atem_container.classList.remove('online');
        this.atem_container.classList.remove('offline');

        this.beamer_container.querySelectorAll('.beamer-button').forEach(button => button.classList.add('disabled'));
        this.disable_atem_buttons();
    }

    on_message(message) {

        if (message.destinationName == 'beamer/plenar/lamp_state')
        {
            const state = message.payloadBytes[0];
            if (state) {
                this.beamer_container.classList.add('online');
                this.beamer_container.classList.remove('offline');
            } else {
                this.beamer_container.classList.add('offline');
                this.beamer_container.classList.remove('online');
            }

            return true;
        }

        if (message.destinationName == 'atem/plenarsaal/status')
        {
            const res = JSON.parse(message.payloadString);
            if (res.upstream) {
                this.atem_container.classList.add('online');
                this.atem_container.classList.remove('offline');
            } else {
                this.atem_container.classList.add('offline');
                this.atem_container.classList.remove('online');
                this.disable_atem_buttons();
            }

            return true;
        }

        if (message.destinationName == 'atem/plenarsaal/program-bus-input')
        {
            const res = JSON.parse(message.payloadString);
            if ('source' in res)
                this.active_source = res.source;
            else
                this.active_source = res['0'].source;
            this.update_active_source();
            return true;
        }

        if (message.destinationName == 'atem/plenarsaal/preview-bus-input')
        {
            const res = JSON.parse(message.payloadString);
            if ('source' in res)
                this.active_preview = res.source;
            else
                this.active_preview = res['0'].source;
            this.update_active_source();
            return true;
        }

        if (message.destinationName == 'atem/plenarsaal/aux-output-source')
        {
            const res = JSON.parse(message.payloadString);
            if ('source' in res)
                this.active_output = res.source;
            else
                this.active_output = res['0'].source;
            this.update_active_output();
            return true;
        }

        if (message.destinationName == 'atem/plenarsaal/input-properties')
        {
            const res = JSON.parse(message.payloadString);
            let new_sources = '';
            let new_outputs = '';
            for (const [k, v] of Object.entries(res)) {
                // port_types:
                // 0 HDMI in
                // 1 Black
                // 2 Bars
                // 3 Color
                // 4 Media Player
                // 5 Media Player Key
                // 6 Supersource
                // 7 Passthrough
                // 128 Program / Preview
                // 129 Output
                // 131 Multiview, Recording Status, Streaming Status, Audio Status
                if ([0, 1, 2, 3, 4].includes(v.port_type)) {
                    let template = document.getElementById(`template-atem-button`).innerHTML;
                    template = template.replace('{ text }', v.short_name);
                    template = template.replace('{ title }', v.name);
                    template = template.replace('{ index }', k);
                    new_sources += template;
                }
                if ([0, 128].includes(v.port_type) || v.index == 9001) { // HDMIs, program, preview, multiview
                    let template = document.getElementById(`template-atem-button`).innerHTML;
                    template = template.replace('{ text }', v.short_name);
                    template = template.replace('{ title }', v.name);
                    template = template.replace('{ index }', k);
                    new_outputs += template;
                }
            }
            this.atem_content.querySelector('.sources').innerHTML = new_sources;
            this.atem_content.querySelector('.outputs').innerHTML = new_outputs;
            this.update_active_source();
            this.update_active_output();
            this.register_atem_events();

            return true;
        }

        // if (message.destinationName == 'atem/plenar/')
        if (message.destinationName.startsWith('atem/plenarsaal/mulasfd'))
        {
            console.log(`${message.destinationName} ${message.payloadString}`)
            return true;
        }
        // show infos:
        // firmware
        // video-mode
    }

    register_events() {
        this.beamer_container.querySelectorAll('.beamer-button').forEach(button => {
            button.addEventListener('click', event => {
                event.preventDefault();
                const message = new Messaging.Message(button.dataset['mqttMessage']);
                message.destinationName = button.dataset['topic'];
                mqtt_controller.mqtt_client.send(message);
            });
        });
    }

    register_atem_events() {
        this.atem_content.querySelectorAll('.sources > .atem-button').forEach(button => {
            button.addEventListener('click', event => {
                event.preventDefault();
                const source = button.dataset['index'];
                const payload = `{"index":0, "source": ${source}}`;
                const message = new Messaging.Message(payload);
                message.destinationName =  'atem/plenarsaal/set/program-input';
                mqtt_controller.mqtt_client.send(message);
            });
        });
        this.atem_content.querySelectorAll('.sources > .atem-button').forEach(button => {
            button.addEventListener('contextmenu', event => {
                event.preventDefault();
                const source = button.dataset['index'];
                const payload = `{"index":0, "source": ${source}}`;
                const message = new Messaging.Message(payload);
                message.destinationName =  'atem/plenarsaal/set/preview-input';
                mqtt_controller.mqtt_client.send(message);
            });
        });
        this.atem_content.querySelectorAll('.outputs > .atem-button').forEach(button => {
            button.addEventListener('click', event => {
                event.preventDefault();
                const source = button.dataset['index'];
                const payload = `{"index":0, "source": ${source}}`;
                const message = new Messaging.Message(payload);
                message.destinationName =  'atem/plenarsaal/set/aux-source';
                mqtt_controller.mqtt_client.send(message);
            });
        });
    }

    on_show() {
    }

    update_active_source() {
        const sources_container = this.atem_content.querySelector('.sources');
        sources_container.querySelectorAll('.atem-button').forEach(button => {
            button.classList.remove('active');
            button.classList.remove('preview');
        });
        const active = sources_container.querySelector(`.atem-button[data-index="${this.active_source}"]`);
        const preview = sources_container.querySelector(`.atem-button[data-index="${this.active_preview}"]`);
        if (active) active.classList.add('active');
        if (preview) preview.classList.add('preview');
    }

    update_active_output() {
        this.atem_content.querySelectorAll('.outputs > .atem-button').forEach(button => {
            button.classList.remove('active');
        });
        const active = this.atem_content.querySelector(`.outputs > .atem-button[data-index="${this.active_output}"]`);
        if (active) active.classList.add('active');
    }

    disable_atem_buttons() {
        this.atem_content.querySelectorAll('.atem-button').forEach(button => {
            button.classList.add('disabled');
        });
    }
}

class MqttController {

    constructor() {
        this.connected = false;
        this.mqtt_client = undefined;
    }

    on_load() {
        this.init_websockets();
    }

    on_connect() {
    }

    on_disconnect() {
    }

    on_message(message) {
    }

    register_events() {
    }

    on_show() {
    }

    init_websockets() {
        console.log('setting up mqtt connection');
        //this.mqtt_client = new Messaging.Client(location.hostname, Number(location.port), this.generate_clientid());
        //this.mqtt_client = new Messaging.Client(location.hostname, 9000, this.generate_clientid());
        this.mqtt_client = new Messaging.Client('172.23.23.110', 9000, this.generate_clientid());
        // this.mqtt_client = new Messaging.Client('127.0.0.1', 9000, this.generate_clientid());
        this.mqtt_client.onConnectionLost = this.callback_connection_lost.bind(this);
        this.mqtt_client.onMessageArrived = this.callback_message_arrived.bind(this);
        this.mqtt_client.connect({onSuccess:this.callback_connect.bind(this), onFailure:this.callback_connect_failure.bind(this)});
    }

    // generate a random mqtt clientid
    generate_clientid() {
        return 'wscl_yxxxxxxxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random()*16|0, v = c == 'x' ? r : (r&0x3|0x8);
            return v.toString(16);
        });
    }

    callback_connect_failure() {
        console.log('mqtt connect failed, retrying in 5 sec');
        setTimeout(this.init_websockets.bind(this), 5000);
    }

    callback_connect() {
        // the mqtt library eats all exceptions, so print them here for debugging
        try {
            console.log('onConnect');
            // this is broken in the callback
            mqtt_controller.connected = true;
            // Once a connection has been made, make subscriptions and enable buttons.
            controller_list.forEach(ctl => ctl.on_connect());
        } catch (error) {
            console.error(error);
            throw error;
        }
    }

    callback_connection_lost(responseObject) {
        // the mqtt library eats all exceptions, so print them here for debugging
        try {
            console.log('mqtt connection lost, reconnecting in 5 sec');
            // this is broken in the callback
            mqtt_controller.connected = false;
            controller_list.forEach(ctl => ctl.on_disconnect());
            setTimeout(this.init_websockets.bind(this), 5000);
        } catch (error) {
            console.error(error);
            throw error;
        }
    }

    callback_message_arrived(message) {
        // the mqtt library eats all exceptions, so print them here for debugging
        try {
            controller_list.forEach(ctl => ctl.on_message(message));
        } catch (error) {
            console.error(error);
            throw error;
        }
    }

    is_connected() {
        return this.connected;
    }
}

class AnchorController {

    on_load() {
        const anchor = window.location.hash.substring(1);
        if (!anchor)
            return;
        const components = anchor.split('/');
        if (components.length != 2)
            return;
        const room = components[0];
        const tab = components[1];
        if (!(room in functions_controller.room_name_map)) // check if room is valid
            return;
        const tabs = functions_controller.get_tabs_for_room(room);
        if (!tabs.includes(tab)) // check if tab is valid
            return;
        const tab_element = document.getElementById('functions-popup').querySelector(`ul.tabbar > li.tab-button[data-tab="${tab}"]`);
        if (!tab_element) // should not fail
            return;
        window.location.hash = '';
        functions_controller.open_popup(room);
        functions_controller.on_tab_button_press(tab_element);
    }

    on_connect() {
    }

    on_disconnect() {
    }

    on_message(message) {
    }

    register_events() {
    }

    on_show() {
    }
}

class BusleisteController {

    constructor() {
        this.container = document.querySelector('.tab-content.tab-busleiste');
        this.active_module = undefined;
        this.active_interrupt = undefined;
        this.modules = new Map();
    }

    on_load() {
    }

    on_connect() {
        mqtt_controller.mqtt_client.subscribe('busleiste/active_interrupt');
        mqtt_controller.mqtt_client.subscribe('busleiste/active_module');
        mqtt_controller.mqtt_client.subscribe('busleiste/modules');
        mqtt_controller.mqtt_client.subscribe('busleiste/modules/+/enabled');
        mqtt_controller.mqtt_client.subscribe('busleiste/modules/+/settings');

        this.container.querySelectorAll('.submit-button').forEach(button => button.classList.remove('disabled'));
    }

    on_disconnect() {
        this.container.querySelectorAll('.activate-button').forEach(button => button.classList.add('module-unknown'));
        this.container.querySelectorAll('.enable-button').forEach(button => button.classList.add('module-unknown'));
        this.container.querySelectorAll('.submit-button').forEach(button => button.classList.add('disabled'));

        this.container.querySelectorAll('.module').forEach(button => button.classList.remove('paused'));
        this.container.querySelectorAll('.module').forEach(button => button.classList.remove('active'));
    }

    on_message(message) {

        if (message.destinationName == 'busleiste/modules') {

            // reset existance values
            for (const [_module_name, module_data] of this.modules) {
                module_data.exists = false;
            }

            const module_map = JSON.parse(message.payloadString);
            for (const [_, value] of Object.entries(module_map)) {
                const module_name = value[0];
                const module_human_name = value[1];

                if (!this.modules.has(module_name)) {
                    this.modules.set(module_name, new Object());
                    this.modules.get(module_name).enabled = undefined;
                }

                this.modules.get(module_name).name = module_name;
                this.modules.get(module_name).human_name = module_human_name;
                this.modules.get(module_name).exists = true;
                this.modules.get(module_name).enabled = undefined;
            };

            this.update_module_widget_list();

            return true;
        }

        if (/^busleiste\/modules\/[^\/]+\/enabled$/.test(message.destinationName)) {

            const module_name = message.destinationName.split('/')[2];
            const enabled = (message.payloadBytes[0] != 0);

            if (!this.modules.has(module_name)) {
                this.modules.set(module_name, new Object());
                this.modules.set(module_name).name = module_name;
                this.modules.set(module_name).exists = false;
            }

            this.modules.get(module_name).enabled = enabled;

            // update enabled status
            if (this.modules.get(module_name).exists) {
                const module_node = this.container.querySelector(`.module[data-name="${module_name}"]`);
                const enable_button = module_node.querySelector('.enable-button');
                if (enabled === true) {
                    enable_button.classList.remove('module-unknown');
                    enable_button.classList.remove('module-disabled');
                    enable_button.classList.add('module-enabled');
                } else if (enabled === false) {
                    enable_button.classList.remove('module-unknown');
                    enable_button.classList.add('module-disabled');
                    enable_button.classList.remove('module-enabled');
                }
            }

            return true;
        }

        if (message.destinationName == 'busleiste/active_module') {
            this.active_module = message.payloadString;
            this.update_module_widget_states();
        }

        if (message.destinationName == 'busleiste/active_interrupt') {
            this.active_interrupt = message.payloadString === '' ? undefined : message.payloadString;
            this.update_module_widget_states();
        }
    }

    update_module_widget_list() {
        // add existant module not yet in the list
        for (const [module_name, module_data] of this.modules) {
            const module_node = this.container.querySelector(`.module[data-name="${module_name}"]`);

            // remove non-existant module widget
            if (module_node != null && !module_data.exists) {
                module_node.remove();
            }

            // add missing widget
            if (module_node == null && module_data.exists) {

                let template = document.getElementById('template-busleiste-module').innerHTML;
                template = template.replaceAll('{ name }', module_name);
                const template_node = document.createElement('template');
                template_node.innerHTML = template.trim();
                const new_node = template_node.content.firstChild;
                this.container.appendChild(new_node);

                const activate_button = new_node.querySelector('.activate-button');
                const enable_button = new_node.querySelector('.enable-button');
                if (module_data.enabled === true) {
                    enable_button.classList.remove('module-disabled');
                    enable_button.classList.add('module-enabled');
                } else if (module_data.enabled === false) {
                    enable_button.classList.add('module-disabled');
                    enable_button.classList.remove('module-enabled');
                }

                // register events
                enable_button.addEventListener('click', event => {
                    event.preventDefault();
                    GeneralController.onoff(`busleiste/modules/${module_name}/enabled`, (module_data.enabled !== true));
                });
                activate_button.addEventListener('click', event => {
                    event.preventDefault();
                    const payload = module_name;
                    const message = new Messaging.Message(payload);
                    message.destinationName = 'busleiste/change_module';
                    message.retained = true;
                    mqtt_controller.mqtt_client.send(message);
                });

                if (module_name != 'Text') { // TODO this needs to be parametric
                    const data_container = new_node.querySelector('.data-container');
                    data_container.remove();
                } else {
                    const submit_button = new_node.querySelector('.submit-button');
                    const textarea = new_node.querySelector('textarea');

                    submit_button.addEventListener('click', event => {
                        event.preventDefault();
                        const text = textarea.value;
                        const lines = text.split('\n');
                        let payload;
                        if (text == '') {
                            payload = '';
                        } else {
                            while (lines.length < 4)
                                lines.push('');
                            payload = JSON.stringify(lines);
                        }
                        const message = new Messaging.Message(payload);
                        message.destinationName = 'busleiste/modules/Text/settings';
                        message.retained = true;
                        mqtt_controller.mqtt_client.send(message);
                    });
                }
            }
        }

        this.update_module_widget_states();
    }

    update_module_widget_states() {
        this.container.querySelectorAll('.module').forEach(module_node => {
            const activate_button = module_node.querySelector('.activate-button');
            const module_name = module_node.dataset['name'];

            if (this.active_module !== undefined) {
                const active = (module_name == this.active_interrupt) || (module_name == this.active_module && this.active_interrupt === undefined);
                const paused = (module_name == this.active_module && this.active_interrupt !== undefined);

                activate_button.classList.remove('module-unknown');
                if (module_name == this.active_module) {
                    activate_button.classList.add('module-active');
                    activate_button.classList.remove('module-inactive');
                } else {
                    activate_button.classList.remove('module-active');
                    activate_button.classList.add('module-inactive');
                }

                if (active) {
                    module_node.classList.add('active');
                    module_node.classList.remove('paused');
                } else if (paused) {
                    module_node.classList.remove('active');
                    module_node.classList.add('paused');
                } else {
                    module_node.classList.remove('active');
                    module_node.classList.remove('paused');
                }
            }
        });
    }

    on_show() {
    }
}


const controller_list = [];
const general_controller = new GeneralController();
const dmx_controller = new DmxController();
const mpd_controller = new MpdController();
const infrastructure_controller = new InfrastructureController();
const functions_controller = new FunctionsController();
const preset_controller = new PresetController();
const media_controller = new MediaController();
const busleiste_controller = new BusleisteController();
const anchor_controller = new AnchorController();
const mqtt_controller = new MqttController();
controller_list.push(general_controller);
controller_list.push(dmx_controller);
controller_list.push(mpd_controller);
controller_list.push(infrastructure_controller);
controller_list.push(functions_controller);
controller_list.push(preset_controller);
controller_list.push(media_controller);
controller_list.push(busleiste_controller);
controller_list.push(anchor_controller);
controller_list.push(mqtt_controller); // should be the last one in the list

controller_list.forEach(ctl => ctl.on_load());
