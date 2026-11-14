"""Independent reference for the app's balanced SGD, not sklearn LBFGS.

Changing solver and negative partition is explicit in round 3 evidence.
No fastmath: draw order, double accumulation and float32 stores are contractual.
"""
import math
import numpy as np
from numba import njit
@njit(cache=True)
def train(positive, negative, ranges):
    w = np.zeros(1152,np.float32); bias = 0.; seed = 12345
    snapshots = np.zeros((3,1154),np.float64); slot=0
    for epoch in range(50):
        rate=.08/(1+epoch/12)
        for i in range(2400):
            seed=(seed*1664525+1013904223)&0xffffffff
            r=int(seed/4294967296*len(ranges))
            seed=(seed*1664525+1013904223)&0xffffffff
            pos=i%2==0
            if pos:
                x=positive[int(seed/4294967296*len(positive))]
            else:
                offset=(ranges[r,0]+int(seed/4294967296*(ranges[r,1]-ranges[r,0]-12)))*96
                x=negative[offset:offset+1152]
            score=0.
            for j in range(1152): score+=float(np.float64(w[j]))*float(np.float64(x[j]))
            prediction=1/(1+math.exp(-max(-30.,min(30.,score+bias))))
            error=(1. if pos else 0.)-prediction
            for j in range(1152): w[j]=np.float64(w[j])+rate*(error*np.float64(x[j])-.00003*np.float64(w[j]))
            bias+=rate*error
            step=epoch*2400+i+1
            if step==1 or step==10 or step==120000:
                snapshots[slot,:1152]=w
                snapshots[slot,1152]=bias
                snapshots[slot,1153]=-math.log(max(1e-15,1-error if pos else 1+error))
                slot+=1
    return w,bias,snapshots
