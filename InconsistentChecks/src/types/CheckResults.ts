interface CheckResults {
    success: boolean;
    error?: {
        message: string;
        type: string;
    };
}

export default CheckResults;