import CheckError from "./CheckError";

interface CheckResult {
    error: CheckError;
    payload?: any;
}

export default CheckResult;