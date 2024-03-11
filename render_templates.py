#! /usr/bin/python3

from jinja2 import Environment, FileSystemLoader, select_autoescape

env = Environment(
    loader=FileSystemLoader('./templates/'),
    autoescape=select_autoescape(['html', 'xml'])
)

rendered = env.get_template('index.html').render().lstrip()

with open('index.html', 'w') as f:
    f.write(rendered)
