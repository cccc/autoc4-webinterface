all: styles.css index.html

styles.css: styles.less
	${HOME}/node_modules/less/bin/lessc $< > $@
#	lesscpy $< > $@

index.html: templates/index.html render_templates.py
	./render_templates.py

.PHONY: all
