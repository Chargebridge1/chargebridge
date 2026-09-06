/**
 * Expo config plugin: withNativeCrashDiagnostics
 *
 * Patches RCTTurboModule.mm to fix the void-method async crash and capture
 * the throwing module/method for JS reading on the next launch.
 *
 * Root-cause (confirmed by builds 155–159 crash logs)
 * ---------------------------------------------------
 * performVoidMethodInvocation's @catch always calls convertNSExceptionToJSError,
 * even when the block runs on a background GCD thread (no isSync guard).
 * convertNSExceptionToJSError calls Hermes JSI from that background thread,
 * which races with the JS thread (RCTJSThreadManager) running its own Hermes
 * operations. The concurrent JSI access corrupts a Hermes heap object, causing
 * the JS thread to SIGSEGV at an unrelated site (regexp/iterator/split/GC —
 * whatever it happens to be doing). This explains the non-deterministic secondary
 * crash frames across all five builds.
 *
 * Build 159 confirmed: Speech disabled, crash still happens → void method
 * culprit is NOT Speech. NSLog fires before JSI call (visible in Console.app)
 * but module name requires either Console.app or the NSUserDefaults approach.
 *
 * Patches applied
 * ---------------
 * 1. convertNSExceptionToJSError: nil-safe reason/name; NSLog before any JSI;
 *    remove two convertNSArrayToJSIArray calls (unsafe from background thread).
 * 2. performMethodInvocation @catch: NSLog before isSync branch.
 * 3. performVoidMethodInvocation @catch: NSLog + NSUserDefaults write BEFORE
 *    any JSI call; for async invocations re-throw as ObjC exception instead of
 *    calling JSI (same pattern performMethodInvocation uses for async — it's a
 *    bug that performVoidMethodInvocation didn't have this guard).
 * 4. performVoidMethodInvocation before-block: capture _cbIsAsync so the
 *    @catch block can use it without capturing a C++ member variable.
 */

const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

module.exports = function withNativeCrashDiagnostics(config) {
  return withDangerousMod(config, [
    "ios",
    async (config) => {
      const filePath = path.join(
        config.modRequest.projectRoot,
        "node_modules",
        "react-native",
        "ReactCommon",
        "react",
        "nativemodule",
        "core",
        "platform",
        "ios",
        "ReactCommon",
        "RCTTurboModule.mm"
      );

      if (!fs.existsSync(filePath)) {
        console.warn(
          "[withNativeCrashDiagnostics] RCTTurboModule.mm not found at:",
          filePath
        );
        return config;
      }

      let content = fs.readFileSync(filePath, "utf8");

      if (content.includes("[ChargeBridge] convertNSExceptionToJSError")) {
        console.log(
          "[withNativeCrashDiagnostics] RCTTurboModule.mm already patched, skipping."
        );
        return config;
      }

      let patched = 0;

      // -----------------------------------------------------------------------
      // Patch 1: convertNSExceptionToJSError
      //   - nil-safe reason + name
      //   - NSLog BEFORE any JSI call (visible in Console.app even if Hermes crashes)
      //   - Remove convertNSArrayToJSIArray calls (unsafe from background thread)
      // -----------------------------------------------------------------------
      const old1 = `  std::string reason = [exception.reason UTF8String];

  jsi::Object cause(runtime);
  cause.setProperty(runtime, "name", [exception.name UTF8String]);
  cause.setProperty(runtime, "message", reason);
  cause.setProperty(runtime, "stackSymbols", convertNSArrayToJSIArray(runtime, exception.callStackSymbols));
  cause.setProperty(
      runtime, "stackReturnAddresses", convertNSArrayToJSIArray(runtime, exception.callStackReturnAddresses));

  std::string message = moduleName + "." + methodName + " raised an exception: " + reason;`;

      const new1 = `  const char *_cbReasonCStr = exception.reason ? [exception.reason UTF8String] : "";
  std::string reason = _cbReasonCStr ? _cbReasonCStr : "";
  const char *_cbNameCStr = exception.name ? [exception.name UTF8String] : "NSException";
  // CB-DIAG: log before any JSI call — visible in Console.app even if Hermes then crashes
  NSLog(@"[ChargeBridge] convertNSExceptionToJSError %s.%s name=%s reason=%s",
        moduleName.c_str(), methodName.c_str(), _cbNameCStr, reason.c_str());

  jsi::Object cause(runtime);
  cause.setProperty(runtime, "name", _cbNameCStr);
  cause.setProperty(runtime, "message", reason);
  // CB-DIAG: callStackSymbols/callStackReturnAddresses skipped —
  // bridging NSArray from a background thread via convertNSArrayToJSIArray
  // is the proximate trigger of the secondary Hermes crash.

  std::string message = moduleName + "." + methodName + " raised an exception: " + reason;`;

      if (content.includes(old1)) {
        content = content.replace(old1, new1);
        patched++;
        console.log("[withNativeCrashDiagnostics] Patch 1 applied: convertNSExceptionToJSError");
      } else {
        console.warn("[withNativeCrashDiagnostics] Patch 1 NOT applied: string not found");
      }

      // -----------------------------------------------------------------------
      // Patch 2: performMethodInvocation @catch — add NSLog before isSync branch
      // -----------------------------------------------------------------------
      const old2 = `    } @catch (NSException *exception) {
      if (isSync) {
        // We can only convert NSException to JSError in sync method calls.
        // See https://github.com/reactwg/react-native-new-architecture/discussions/276#discussioncomment-12567155
        throw convertNSExceptionToJSError(runtime, exception, std::string{moduleName}, methodNameStr);
      } else {
        @throw exception;
      }
    } @finally {`;

      const new2 = `    } @catch (NSException *exception) {
      // CB-DIAG: log module + method before any JSI call
      NSLog(@"[ChargeBridge] NSException in %s.%s (sync=%d): name=%@ reason=%@",
            moduleName, methodName, isSync, exception.name, exception.reason);
      if (isSync) {
        // We can only convert NSException to JSError in sync method calls.
        // See https://github.com/reactwg/react-native-new-architecture/discussions/276#discussioncomment-12567155
        throw convertNSExceptionToJSError(runtime, exception, std::string{moduleName}, methodNameStr);
      } else {
        @throw exception;
      }
    } @finally {`;

      if (content.includes(old2)) {
        content = content.replace(old2, new2);
        patched++;
        console.log("[withNativeCrashDiagnostics] Patch 2 applied: performMethodInvocation @catch");
      } else {
        console.warn("[withNativeCrashDiagnostics] Patch 2 NOT applied: string not found");
      }

      // -----------------------------------------------------------------------
      // Patch 3: performVoidMethodInvocation @catch
      //   - NSLog for Console.app
      //   - NSUserDefaults write BEFORE any JSI call (survives process crash,
      //     readable via React Native Settings.get() on next launch)
      //   - For ASYNC invocations: @throw instead of calling JSI from bg thread
      //     (the root fix — same guard that performMethodInvocation has)
      // -----------------------------------------------------------------------
      const old3 = `    } @catch (NSException *exception) {
      throw convertNSExceptionToJSError(runtime, exception, std::string{moduleName}, methodNameStr);
    } @finally {
      [retainedObjectsForInvocation removeAllObjects];
    }`;

      const new3 = `    } @catch (NSException *exception) {
      // CB-DIAG: log module + method (visible in Console.app before any JSI call)
      NSLog(@"[ChargeBridge] NSException in void %s.%s (async=%d): name=%@ reason=%@",
            moduleName, methodName, _cbIsAsync, exception.name, exception.reason);
      // CB-DIAG: write to NSUserDefaults BEFORE any JSI call.
      // Survives process crash; readable from JS via Settings.get("CBVoidExcModule").
      @autoreleasepool {
        NSUserDefaults *_cbUD = [NSUserDefaults standardUserDefaults];
        [_cbUD setObject:[NSString stringWithFormat:@"%s", moduleName] forKey:@"CBVoidExcModule"];
        [_cbUD setObject:[NSString stringWithFormat:@"%s", methodName] forKey:@"CBVoidExcMethod"];
        [_cbUD setObject:(exception.name ?: @"nil") forKey:@"CBVoidExcName"];
        [_cbUD setObject:(exception.reason ?: @"nil") forKey:@"CBVoidExcReason"];
        [_cbUD synchronize];
      }
      if (_cbIsAsync) {
        // CB-DIAG: for async void methods, re-throw as ObjC exception instead of
        // calling convertNSExceptionToJSError from the background thread.
        // Calling JSI from a non-JS thread races with the JS thread's Hermes
        // runtime → corrupts heap → secondary SIGSEGV on JS thread at unrelated
        // site (regexp/iterator/GC — whatever Hermes is doing at that moment).
        // performMethodInvocation has this same guard; performVoidMethodInvocation
        // was missing it — this is the root bug.
        @throw exception;
      }
      throw convertNSExceptionToJSError(runtime, exception, std::string{moduleName}, methodNameStr);
    } @finally {
      [retainedObjectsForInvocation removeAllObjects];
    }`;

      if (content.includes(old3)) {
        content = content.replace(old3, new3);
        patched++;
        console.log("[withNativeCrashDiagnostics] Patch 3 applied: performVoidMethodInvocation @catch");
      } else {
        console.warn("[withNativeCrashDiagnostics] Patch 3 NOT applied: string not found");
      }

      // -----------------------------------------------------------------------
      // Patch 4: performVoidMethodInvocation — capture _cbIsAsync before block
      //   The block cannot reference shouldVoidMethodsExecuteSync_ (C++ member)
      //   safely from all contexts; capture it as a plain bool before the block.
      // -----------------------------------------------------------------------
      const old4 = `  __block int32_t asyncCallCounter = 0;

  void (^block)() = ^{`;

      const new4 = `  __block int32_t asyncCallCounter = 0;
  // CB-DIAG: capture sync flag so the @catch block can use it
  const bool _cbIsAsync = !shouldVoidMethodsExecuteSync_;

  void (^block)() = ^{`;

      // Only apply Patch 4 inside performVoidMethodInvocation, not performMethodInvocation.
      // performVoidMethodInvocation comes second; find the second occurrence.
      const idx4 = content.lastIndexOf(old4);
      if (idx4 !== -1) {
        content = content.slice(0, idx4) + new4 + content.slice(idx4 + old4.length);
        patched++;
        console.log("[withNativeCrashDiagnostics] Patch 4 applied: _cbIsAsync capture");
      } else {
        console.warn("[withNativeCrashDiagnostics] Patch 4 NOT applied: string not found");
      }

      fs.writeFileSync(filePath, content);
      console.log(
        `[withNativeCrashDiagnostics] Done — ${patched}/4 patches applied to RCTTurboModule.mm`
      );

      return config;
    },
  ]);
};
