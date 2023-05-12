class ToolsError extends Error {
    constructor(message: string) {
        super(message);
    }

    toJSON() {
        return {
            message: this.message,
        }
    }
}

export default ToolsError;