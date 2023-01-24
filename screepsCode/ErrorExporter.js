RawMemory.setActiveSegments([10])

export default class ErrorExporter {
    static segment = 10

    static getSegmentData() {
        const segment = RawMemory.segments[this.segment]
        if (segment === undefined || segment.length === 0) return { errors: [], reset: false }
        else return JSON.parse(RawMemory.segments[this.segment])
    }

    static setSegmentData(data) {
        RawMemory.segments[this.segment] = JSON.stringify(data)
    }

    static addErrorToSegment(error) {
        const data = this.getSegmentData()
        data.errors.push({
            stack: error.stack,
            time: Game.time,
            shard: Game.shard.name,
        })
        this.setSegmentData(data)
    }
}
