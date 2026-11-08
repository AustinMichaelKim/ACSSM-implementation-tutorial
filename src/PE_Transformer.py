import torch
from torch import nn
import math

def continuous_time_encoding(
    
    times: torch.Tensor,
    embed_dim: int
) -> torch.Tensor:

    # 1. sin/cos를 쌍으로 사용하므로 짝수 차원 요구
    if embed_dim % 2 != 0:
        raise ValueError("embed_dim must be even.")

    # 2. 시간 텐서의 shape
    B, T = times.shape

    """
        Make frequencies for even number;  10000^(-2k/D)

        = 10000^{0, -2, -4, -6} = ( 1, 0.1, 0.01, 0.001 )
    """
    frequencies = torch.exp(
        -math.log(10000.0)
        * torch.arange(
            0, embed_dim, 2,
            device=times.device,
            dtype=times.dtype,
        )
        / embed_dim
    )

    """
        multiplying.  times * frequencies = ( t, 0.1t, 0.01t, 0.001t )

        (B,T,1) * (D/2) = (B,T,D/2)
        : at each Batch and time, PE vector resides.
    """
    angles = times.unsqueeze(-1) * frequencies


    """
        stack cos vector to the last dim.
        
    """
    pe = torch.stack(
        [angles.sin(), angles.cos()],
        dim=-1
    )

    # 6. 마지막 두 축을 합쳐 (B,T,D)로 반환
    return pe.reshape(B, T, embed_dim)




class ACSSMTransformer(nn.Module):

    def __init__(self,embed_dim : int, nheads: int):
        super().__init__()

        self.embed_dim = embed_dim
        self.nheads = nheads

        self.transformer = nn.TransformerEncoderLayer(
            d_model=embed_dim,
            nhead = nheads,
            dim_feedforward=4 * embed_dim,
            dropout=0.0,
            batch_first=True,
        )


    def forward(self, input_latent_vector , times, obs_mask):

        y = input_latent_vector

        times_input = times.to(
            device = y.device,
            dtype=y.dtype
        )

        time_embedding = continuous_time_encoding(
            times_input,
            self.embed_dim
        )
        

        z_raw = self.transformer(
            y + time_embedding,
            src_key_padding_mask = ~obs_mask
        )

        print("time_embedding:", time_embedding.shape)
        print("transformer_input:", y.shape)
        print("z_raw:", z_raw.shape)


        return z_raw



def masking_unseen_data_Full_Assim( transformer_output, obs_mask ):

    B,T,D = transformer_output.shape
    
    positions = torch.arange(
        T, device=transformer_output.device).unsqueeze(0).expand(B,-1)

    observed_positions = torch.where(
        obs_mask,
        positions,
        torch.full_like(positions, -1)
    )

    last_observed_idx, _ = torch.cummax(observed_positions, dim=1)

    gather_idx = last_observed_idx.unsqueeze(-1).expand(-1,-1,D)

    z = torch.gather(transformer_output,dim=1, index=gather_idx )

    return z
