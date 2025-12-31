"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

type CharsetKey = 'lowerAlphaNum' | 'mixedAlphaNum' | 'fullAscii';

const CHARSETS: Record<CharsetKey, { label: string, value: string }> = {
  lowerAlphaNum: { label: "Standard (a-z0-9)", value: "abcdefghijklmnopqrstuvwxyz0123456789" },
  mixedAlphaNum: { label: "Mixed Case (a-zA-Z0-9)", value: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789" },
  fullAscii: { label: "All Symbols (Full ASCII)", value: " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~" },
};

export default function CreateJobPage() {
const [hash, setHash] = useState("")
const [charsetKey, setCharsetKey] = useState<CharsetKey>("lowerAlphaNum")
const [isLoading, setIsLoading] = useState(false)
const router = useRouter()

const handleSubmit = async (e: React.FormEvent) => {
 e.preventDefault()
 setIsLoading(true)

 try {
   // Incremental Mode: We don't define keyspace or checks manually anymore.
   // We pass 0 as keyspace/chunkSize to let server defaults handle the "Wave 1" init.
   // Server will default chunkSize to 10M or similar.
   
   const res = await fetch("/api/jobs/create", {
     method: "POST",
     headers: { "Content-Type": "application/json" },
     body: JSON.stringify({
       hash,
       keyspace: 0, // Ignored/Auto
       chunkSize: 50000000, // 50M seems good for granular distribution
       charset: CHARSETS[charsetKey].value
     }),
   })

   if (!res.ok) {
     throw new Error("Failed to create job")
   }

   router.push("/jobs")
   router.refresh()
 } catch (error) {
   console.error(error)
   alert("Error creating job")
 } finally {
   setIsLoading(false)
 }
}

return (
 <div className="container mx-auto py-10 max-w-2xl">
   <Card>
     <CardHeader>
       <CardTitle>Crack New Hash</CardTitle>
       <CardDescription>Incremental "Blind" Attack. System starts small and expands automatically.</CardDescription>
     </CardHeader>
     <form onSubmit={handleSubmit}>
       <CardContent className="space-y-6">
         <div className="space-y-2">
           <Label htmlFor="hash">Target Hash (MD5)</Label>
           <Input 
             id="hash" 
             placeholder="e.g. 5f4dcc3b5aa765d61d8327deb882cf99" 
             value={hash}
             onChange={(e) => setHash(e.target.value)}
             required
             minLength={32}
             maxLength={32}
             className="font-mono"
           />
         </div>

         <div className="space-y-2">
            <Label>Charset Strategy</Label>
            <Select value={charsetKey} onValueChange={(v) => setCharsetKey(v as CharsetKey)}>
                <SelectTrigger>
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {Object.entries(CHARSETS).map(([key, { label }]) => (
                        <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
                Start with Standard if unsure. Mixed/Symbols will be much slower to expand.
            </p>
         </div>
         
         <div className="p-4 bg-slate-50 dark:bg-slate-900 rounded-md border text-sm text-muted-foreground">
             <p className="mb-2 font-semibold text-foreground">How it works:</p>
             <ul className="list-disc pl-5 space-y-1">
                 <li>Starts checking Length 1-4 immediately (Instant).</li>
                 <li>Then expands to Length 5 (Seconds/Minutes).</li>
                 <li>Then Length 6 (Minutes/Hours)... and so on.</li>
             </ul>
             <p className="mt-2 text-xs">Work is split into small chunks so all workers contribute.</p>
         </div>

       </CardContent>
       <CardFooter>
         <Button type="submit" disabled={isLoading} className="w-full">
           {isLoading ? "Broadcasting..." : "Launch Attack 🚀"}
         </Button>
       </CardFooter>
     </form>
   </Card>
 </div>
)
}
