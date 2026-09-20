// Minimal stub of @earendil-works/pi-coding-agent for headless render tests.
// Bundled in via: --alias:@earendil-works/pi-coding-agent=./tests/pi-coding-agent-stub.mjs
//
// tools.ts imports the built-in tool factories at TOP LEVEL (registration must
// be synchronous), so the headless bundle needs them to exist. These fakes only
// need a shape registerTools() can read — execute() is never called here.

function fakeTool(name) {
  return {
    name,
    label: name.charAt(0).toUpperCase() + name.slice(1),
    description: `fake ${name} tool`,
    parameters: { type: "object", properties: {} },
    execute: async () => ({ content: [] }),
  }
}

export const createBashTool = () => fakeTool("bash")
export const createReadTool = () => fakeTool("read")
export const createEditTool = () => fakeTool("edit")
export const createWriteTool = () => fakeTool("write")
export const createFindTool = () => fakeTool("find")
export const createGrepTool = () => fakeTool("grep")
export const createLsTool = () => fakeTool("ls")
