RawMemory.setActiveSegments([10])

interface CustomError {
    stack: string
    time: number
    shard: string
}

interface ErrorData {
    errors: CustomError[]
    reset: boolean
}

export default class ErrorExporter {
    private static segment = 10

    public static getSegmentData(): ErrorData {
        const segment = RawMemory.segments[this.segment]
        if (segment === undefined || segment.length === 0) return { errors: [], reset: false }
        else return JSON.parse(RawMemory.segments[this.segment])
    }

    public static setSegmentData(data: ErrorData): void {
        RawMemory.segments[this.segment] = JSON.stringify(data)
    }

    public static addErrorToSegment(error: CustomError): void {
        const data = this.getSegmentData()
        data.errors.push({
            stack: error.stack,
            time: Game.time,
            shard: Game.shard.name,
        })
        this.setSegmentData(data)
    }
}
