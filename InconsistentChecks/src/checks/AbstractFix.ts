import AbstractCheck from "./AbstractCheck";

abstract class AbstractFix extends AbstractCheck {
    protected constructor(name: string) {
        super(name);
    }
}

export default AbstractFix;