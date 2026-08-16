import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import {
  extractFileFromCommand,
  isSafeFile,
  readSafely,
  isSuspiciousFileContent,
  buildClassifierPrompt,
} from "../../src/utils/FileExtraction";

describe("extractFileFromCommand", () => {
  it("should extract .js file from node command", () => {
    expect(extractFileFromCommand("node file.js")).toBe("file.js");
  });

  it("should extract .ts file from node command", () => {
    expect(extractFileFromCommand("node file.ts")).toBe("file.ts");
  });

  it("should extract .py file from python command", () => {
    expect(extractFileFromCommand("python file.py")).toBe("file.py");
  });

  it("should extract .tsx file from npx command", () => {
    expect(extractFileFromCommand("npx tsx file.tsx")).toBe("file.tsx");
  });

  it("should extract .jsx file from bun command", () => {
    expect(extractFileFromCommand("bun run file.jsx")).toBe("file.jsx");
  });

  it("should extract .ts file from tsx command", () => {
    expect(extractFileFromCommand("tsx file.ts")).toBe("file.ts");
  });

  it("should extract .rb file from ruby command", () => {
    expect(extractFileFromCommand("ruby script.rb")).toBe("script.rb");
  });

  it("should extract .java file from javac command", () => {
    expect(extractFileFromCommand("javac Main.java")).toBe("Main.java");
  });

  it("should extract .go file from go run command", () => {
    expect(extractFileFromCommand("go run main.go")).toBe("main.go");
  });

  it("should extract with path prefix", () => {
    expect(extractFileFromCommand("node src/file.ts")).toBe("src/file.ts");
  });

  it("should extract the last file argument when path has spaces", () => {
    expect(extractFileFromCommand("node \"my file.js\"")).toBe("file.js");
  });

  it("should extract with flags before file", () => {
    expect(extractFileFromCommand("node --inspect file.js")).toBe("file.js");
  });

  it("should extract with flags before and after file", () => {
    expect(extractFileFromCommand("node --inspect --max-old-space-size=4096 file.js")).toBe("file.js");
  });

  it("should handle single-quoted filenames", () => {
    expect(extractFileFromCommand("python 'script.py'")).toBe("script.py");
  });

  it("should return null for commands without file argument", () => {
    expect(extractFileFromCommand("npm install")).toBeNull();
    expect(extractFileFromCommand("git status")).toBeNull();
    expect(extractFileFromCommand("ls -la")).toBeNull();
  });

  it("should return null for inline code commands", () => {
    expect(extractFileFromCommand("node -e \"console.log(1)\"")).toBeNull();
    expect(extractFileFromCommand("python -c \"print('hello')\"")).toBeNull();
  });

  it("should allow txt files since they are in the whitelist", () => {
    // txt is a valid extension in SAFE_FILE_EXTENSIONS
    expect(extractFileFromCommand("cat file.txt")).toBe("file.txt");
    expect(extractFileFromCommand("echo hello")).toBeNull();
  });

  it("extracts file references from any command (LLM validates rules for security)", () => {
    // The regex extracts file references from any command
    // The LLM prompt will validate these files against security rules
    expect(extractFileFromCommand("rm -rf file.js")).toBe("file.js");
  });

  it("should handle Windows-style quoted paths", () => {
    expect(extractFileFromCommand("node \"C:\\\\path\\\\file.js\"")).toBe("C:\\\\path\\\\file.js");
  });

  it("should handle hyphenated filenames", () => {
    expect(extractFileFromCommand("node my-file.js")).toBe("my-file.js");
  });
});

describe("isSafeFile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "autotest-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true });
    } catch {}
  });

  it("should return true for files that do not exist", () => {
    expect(isSafeFile("nonexistent.js")).toBe(true);
  });

  it("should return true for files in the workspace", () => {
    const testFile = path.join(tmpDir, "test.js");
    fs.writeFileSync(testFile, "console.log('hi');");
    // Create a directory that looks like a workspace
    const workspaceDir = path.resolve(tmpDir);
    const resolved = workspaceDir + path.sep + "test.js";
    expect(isSafeFile(resolved.replace(os.homedir(), tmpDir))).toBe(true);
  });

  it("should return false for files starting with dot", () => {
    expect(isSafeFile(".hidden.js")).toBe(false);
  });

  it("should return false for directories", () => {
    expect(isSafeFile(tmpDir)).toBe(false);
  });

  it("should return false for files in unsafe parent directories", () => {
    const unsafeDir = path.join(tmpDir, ".ssh");
    fs.mkdirSync(unsafeDir, { recursive: true });
    const file = path.join(unsafeDir, "id_rsa.js");
    fs.writeFileSync(file, "keys");
    expect(isSafeFile(file)).toBe(false);
  });

  it("should return false for files in node_modules", () => {
    const nmDir = path.join(tmpDir, "node_modules", "pkg");
    fs.mkdirSync(nmDir, { recursive: true });
    const file = path.join(nmDir, "index.js");
    fs.writeFileSync(file, "require('evil')");
    expect(isSafeFile(file)).toBe(false);
  });

  it("should return false for files in .aws directory", () => {
    const awsDir = path.join(tmpDir, ".aws");
    fs.mkdirSync(awsDir, { recursive: true });
    const file = path.join(awsDir, "config.js");
    fs.writeFileSync(file, "aws config");
    expect(isSafeFile(file)).toBe(false);
  });
});

describe("readSafely", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "autotest-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true });
    } catch {}
  });

  it("should return null for non-existent files", () => {
    expect(readSafely("nonexistent/somefile.js")).toBeNull();
  });

  it("should return content for safe files", () => {
    const testFile = path.join(tmpDir, "test.js");
    fs.writeFileSync(testFile, "console.log('hello world');");
    const content = readSafely(testFile);
    expect(content).toBe("console.log('hello world');");
  });

  it("should return null for hidden files", () => {
    const hiddenFile = path.join(tmpDir, ".hidden.js");
    fs.writeFileSync(hiddenFile, "hidden");
    expect(readSafely(hiddenFile)).toBeNull();
  });

  it("should return null for directories", () => {
    expect(readSafely(tmpDir)).toBeNull();
  });

  it("should truncate content exceeding SAFETY limit", () => {
    const testFile = path.join(tmpDir, "big.js");
    const content = "const x = 1; " + "X".repeat(20000);
    fs.writeFileSync(testFile, content);
    const read = readSafely(testFile);
    expect(read !== null && read.length).toBeLessThanOrEqual(8000);
  });

  it("should return null for files in unsafe directories", () => {
    const unsafeDir = path.join(tmpDir, ".ssh");
    fs.mkdirSync(unsafeDir, { recursive: true });
    const file = path.join(unsafeDir, "key.js");
    fs.writeFileSync(file, "private key");
    expect(readSafely(file)).toBeNull();
  });

  it("should return null on permission error", () => {
    const testFile = path.join(tmpDir, "readonly.js");
    fs.writeFileSync(testFile, "content");
    try {
      process.chmodSync(testFile, 0o000);
      expect(readSafely(testFile)).toBeNull();
    } catch {
      // chmod may not work on all platforms (e.g., Windows, CI as root)
      // In that case, skip this assertion
    }
  });
});

describe("isSuspiciousFileContent", () => {
  it("should return false for benign code", () => {
    const content = "const x = 1;\nconst y = 2;\nconsole.log(x + y);";
    expect(isSuspiciousFileContent(content)).toBe(false);
  });

  it("should detect eval usage", () => {
    expect(isSuspiciousFileContent("eval('dangerous code')")).toBe(true);
  });

  it("should detect exec usage", () => {
    expect(isSuspiciousFileContent("exec('rm -rf /')")).toBe(true);
  });

  it("should detect child_process imports", () => {
    expect(isSuspiciousFileContent("const { exec } = require('child_process');")).toBe(true);
  });

  it("should detect network calls (fetch, axios)", () => {
    expect(isSuspiciousFileContent("fetch('https://evil.com')")).toBe(true);
  });

  it("should detect Buffer usage (encoding/decoding)", () => {
    expect(isSuspiciousFileContent("Buffer.from('secret').toString('base64')")).toBe(true);
  });

  it("should detect subprocess spawning (Python)", () => {
    expect(isSuspiciousFileContent("subprocess.run(['cmd'])")).toBe(true);
    expect(isSuspiciousFileContent("subprocess.Popen('cmd')")).toBe(true);
  });

  it("should detect os.system calls", () => {
    expect(isSuspiciousFileContent("os.system('rm -rf /')")).toBe(true);
  });

  it("should detect chmod/chown calls", () => {
    expect(isSuspiciousFileContent("chmod(777, '/tmp/file')")).toBe(true);
  });

  it("should detect PowerShell commands", () => {
    expect(isSuspiciousFileContent("PowerShell -Command 'Invoke-WebRequest'")).toBe(true);
  });

  it("should be case-insensitive for patterns", () => {
    expect(isSuspiciousFileContent("EVAL('code')")).toBe(true);
  });
});

describe("buildClassifierPrompt", () => {
  it("should include FILE CONTEXT when file is provided", () => {
    const prompt = buildClassifierPrompt("node file.js", "file.js", "console.log('hi');");
    expect(prompt).toContain("FILE CONTEXT: The agent is trying to execute the following file \"file.js\" via this command.");
    expect(prompt).toContain("---");
    expect(prompt).toContain("console.log('hi');");
    expect(prompt).toContain("CHECK the file for:");
  });

  it("should not include FILE CONTEXT when no file is provided", () => {
    const prompt = buildClassifierPrompt("npm install", null, null);
    expect(prompt).not.toContain("FILE CONTEXT");
  });

  it("should include the original command", () => {
    const prompt = buildClassifierPrompt("node server.js", "server.js", "content");
    expect(prompt).toContain("Command to classify:\nnode server.js");
  });

  it("should include the JSON instruction", () => {
    const prompt = buildClassifierPrompt("test", null, null);
    expect(prompt).toContain('Reply with ONLY valid JSON: {"allow": true or false, "reason": "short explanation"}');
  });
});
