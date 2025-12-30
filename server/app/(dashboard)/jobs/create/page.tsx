"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export default function CreateJobPage() {
const [hash, setHash] = useState("")
const [complexity, setComplexity] = useState("standard")
const [keyspace, setKeyspace] = useState(0)
const [chunkSize, setChunkSize] = useState(0)
const [isLoading, setIsLoading] = useState(false)
const router = useRouter()

// Presets
// Standard: Up to 6 chars (2.2B) - Quick for clusters
// Deep: Up to 7 chars (78B) - Hours/Days
// Extreme: Up to 8 chars (2.8T) - Weeks/Months (without massive cluster)
const PRESETS = {
    standard: { label: "Standard (Up to 6 chars)", maxLength: 6 },
    deep: { label: "Deep Search (Up to 7 chars)", maxLength: 7 },
    extreme: { label: "Extreme (Up to 8 chars)", maxLength: 8 },
};

useEffect(() => {
    // @ts-ignore
    const maxLength = PRESETS[complexity].maxLength;
    
    // Calculate Keyspace
    let total = 0;
    let powerOf36 = 1;
    for (let i = 1; i <= maxLength; i++) {
        powerOf36 *= 36;
        total += powerOf36;
    }
    setKeyspace(total);

    // Auto Chunk Size
    const targetChunkSize = 3000000000; // 3B
    
    if (total < targetChunkSize) {
        setChunkSize(Math.max(Math.floor(total / 4), 100000));
    } else {
        setChunkSize(targetChunkSize);
    }

}, [complexity]);

const handleSubmit = async (e: React.FormEvent) => {
 e.preventDefault()
 setIsLoading(true)

 try {
   const res = await fetch("/api/jobs/create", {
     method: "POST",
     headers: { "Content-Type": "application/json" },
     body: JSON.stringify({
       hash,
       keyspace,
       chunkSize,
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
       <CardDescription>Enter the target hash. The system will auto-configure the attack.</CardDescription>
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
            <Label>Search Complexity</Label>
            <Select value={complexity} onValueChange={setComplexity}>
                <SelectTrigger>
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="standard">Standard (Fast)</SelectItem>
                    <SelectItem value="deep">Deep Search (Thorough)</SelectItem>
                    <SelectItem value="extreme">Extreme (Long Runtime)</SelectItem>
                </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
                "Standard" covers most weak passwords. Use "Deep" or "Extreme" if Standard fails.
            </p>
         </div>

         <div className="p-4 bg-slate-50 dark:bg-slate-900 rounded-md border text-sm text-muted-foreground">
             <div className="flex justify-between mb-1">
                <span>Estimated Search Space:</span>
                <span className="font-mono text-foreground">{keyspace.toLocaleString()} combinations</span>
             </div>
             <div className="flex justify-between">
                <span>Max Runtime (1 Worker):</span>
                <span className="font-mono text-foreground">
                {keyspace > 5000000 * 60 * 60 ? `~${((keyspace / 5000000) / 3600).toFixed(1)} hours` : `~${((keyspace / 5000000) / 60).toFixed(1)} mins`}
                </span>
             </div>
         </div>
       </CardContent>
       <CardFooter>
         <Button type="submit" disabled={isLoading} className="w-full">
           {isLoading ? "Broadcasting Job..." : "Start Global Attack"}
         </Button>
       </CardFooter>
     </form>
   </Card>
 </div>
)
}
