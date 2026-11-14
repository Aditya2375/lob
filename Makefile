JAVAC := $(shell [ -x $(HOME)/jdk/bin/javac ] && echo $(HOME)/jdk/bin/javac || command -v javac)
JAVA := $(shell [ -x $(HOME)/jdk/bin/java ] && echo $(HOME)/jdk/bin/java || command -v java)
SRC := $(shell find src -name '*.java')
TEST_SRC := $(shell find tests -name '*.java' 2>/dev/null)
CLASSES := build/classes
TEST_CLASSES := build/test-classes

.PHONY: build test scenarios web clean

build: $(CLASSES)/.stamp

$(CLASSES)/.stamp: $(SRC)
	@mkdir -p $(CLASSES)
	$(JAVAC) -d $(CLASSES) $(SRC)
	@touch $@

test: build
	@mkdir -p $(TEST_CLASSES)
	@if [ -n "$(TEST_SRC)" ]; then $(JAVAC) -cp $(CLASSES) -d $(TEST_CLASSES) $(TEST_SRC); fi
	$(JAVA) -cp $(CLASSES):$(TEST_CLASSES) lob.tests.TestRunner
	node tests/parity.mjs

scenarios: build
	$(JAVA) -cp $(CLASSES) lob.sim.Main data/scenarios

web: scenarios
	node build-web.mjs

clean:
	rm -rf build
