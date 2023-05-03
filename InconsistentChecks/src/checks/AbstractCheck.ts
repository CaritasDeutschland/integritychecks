import CheckResult from "../types/CheckResult";

abstract class AbstractCheck {
    name: string;
    results: CheckResult[] = [];

    protected constructor(name: string) {
        this.name = name;
    }
    abstract run(force: boolean, limit: number | null, skip: number | null): Promise<boolean>;
    abstract getError(): string;

    abstract logHeader(): string[];
    abstract logResult(result: CheckResult): string[];
}

export default AbstractCheck;