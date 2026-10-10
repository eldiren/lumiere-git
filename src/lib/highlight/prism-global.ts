// Prism's language components expect a global `Prism`; expose it before they load.
import Prism from "prismjs";

(globalThis as unknown as { Prism: typeof Prism }).Prism = Prism;
Prism.manual = true;

export default Prism;
