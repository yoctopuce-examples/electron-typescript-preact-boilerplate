// Quick'n dirty "asar" file writer: we don't need all the globbing, etc. functions
// that would come by importing the whole asar package. So let's make it deadly simple,
// this is what the "asar" file format was devised for !

interface AsarFileList {
    files: {
        [filename: string]: {
            offset: string,
            size: number,
            executable: boolean
            // integrity is optional, and brings absolutely no security
            // as the checksum is written in the same file...
        }
    }
}

export class MiniAsarWriter
{
    index: AsarFileList = { files: {} };
    data: string = '';

    addFile(filename: string, content: string): void
    {
        this.index.files[filename] = {
            offset: this.data.length.toString(),
            size: content.length,
            executable: false
        };
        this.data += content;
    }

    makeArchive(): string
    {
        let indexStr: string = JSON.stringify(this.index);
        let indexLen: number = indexStr.length;
        let header: Buffer = Buffer.alloc(16);
        [ 4, indexLen+8, indexLen+4, indexLen ].map((value, idx) => {
            header.writeInt32LE(value, 4*idx)
        });
        return header.toString('binary')+indexStr+this.data;
    }
}
