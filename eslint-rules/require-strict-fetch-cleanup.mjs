const STRICT_STUB_CALLS = new Set(["stubStrictFetch", "stubPageEditor"]);
const CLEANUP_CALLS = new Set(["restoreStrictFetch", "restorePageEditorFetch"]);
const AFTER_EACH_CALLS = new Set(["afterEach"]);

function isNamedCall(node, names) {
  return (
    node?.type === "CallExpression" &&
    node.callee?.type === "Identifier" &&
    names.has(node.callee.name)
  );
}

function walk(node, visit) {
  if (!node || typeof node !== "object") return;
  if (typeof node.type === "string") visit(node);

  for (const [key, value] of Object.entries(node)) {
    if (key === "parent") continue;
    if (Array.isArray(value)) {
      for (const child of value) walk(child, visit);
    } else if (value && typeof value === "object" && typeof value.type === "string") {
      walk(value, visit);
    }
  }
}

function containsNamedCall(node, names) {
  let found = false;
  walk(node, (current) => {
    if (!found && isNamedCall(current, names)) found = true;
  });
  return found;
}

const requireStrictFetchCleanup = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require strict DOM fetch stubs to be restored in afterEach cleanup.",
    },
    schema: [],
    messages: {
      missingCleanup:
        "Tests using strict fetch stubs must call restoreStrictFetch() (or restorePageEditorFetch()) inside afterEach.",
    },
  },
  create(context) {
    return {
      Program(program) {
        let firstStrictCall = null;
        const afterEachCalls = [];

        walk(program, (node) => {
          if (!firstStrictCall && isNamedCall(node, STRICT_STUB_CALLS)) {
            firstStrictCall = node;
          }
          if (isNamedCall(node, AFTER_EACH_CALLS)) {
            afterEachCalls.push(node);
          }
        });

        if (!firstStrictCall) return;

        const hasCleanup = afterEachCalls.some((call) =>
          call.arguments.some((argument) =>
            containsNamedCall(argument, CLEANUP_CALLS),
          ),
        );
        if (!hasCleanup) {
          context.report({
            node: firstStrictCall,
            messageId: "missingCleanup",
          });
        }
      },
    };
  },
};

export default requireStrictFetchCleanup;
