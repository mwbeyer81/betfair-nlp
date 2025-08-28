import "@testing-library/jest-dom";
import "regenerator-runtime/runtime";

// Mock React Native Web environment
if (typeof window !== "undefined") {
  (window as any).__REACT_NATIVE_WEB__ = true;
}
