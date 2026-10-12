# Sliding puzzle

Optimal (IDA*) and Fast (weighted A*) run through 4×4. Each Fast node keeps a full board, so larger sizes exhaust memory. From 5×5 up, one places tiles one at a time and the other places them two at a time. Both can finish a row at a time, or a row and then the column beside it.

The search heuristic is Manhattan distance plus linear conflict. A conflict is two tiles already in their goal row or column but in the wrong order. Each one adds 2, which stays admissible, so IDA* can still claim a shortest solution. If IDA* crosses its node budget it switches to weighted A* at weight 2 and says so.

Weighted A* packs a board into a bigint for the closed set. At weight 1 it reopens a state when it finds a cheaper path, so the result stays optimal. The default weight, 2, does not reopen.
