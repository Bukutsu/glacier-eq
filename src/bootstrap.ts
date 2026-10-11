import { showBootError } from "./lib/bootError";

// Catch bundle-load failures before React's error boundary exists.
void import("./main").catch(showBootError);
