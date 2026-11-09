import torch
from torch import nn


class PSDLocalLinearApprox(nn.Module):
    """
        This class implement NN of mat A and matrix of B with learnable parameter.

        with one forward pass to eval :  z |-> A_i(z) and B(z)

        class initialization: 
            context_dim : the context vector return from the previous transformer.
            state_dim : the dimension of the given process X_t
            num_basis: how many matrix basis of A you want to approx.
        
        forward Input:
            1. context vector z from transformer
    
        forward Return:
            1. the value of matrix A
            2. the value of control vector alpha

            

    """

    def __init__(
            self,
            context_dim : int,
            state_dim: int,
            num_basis : int = 4
    ):
        super().__init__()
        self.context_dim = context_dim
        self.state_dim = state_dim
        self.num_basis = num_basis


        """
            1. free parameter R mat for common eigen basis E

            nn.Parameter assumes the var as the learnable param.

            Therefore, loss.backward() really eval the grad w.r.t this var.
        """
        # randomly initialized only once when the instance is created.
        # (d,d) tensor with the element val sampled from N(0,1)
        # from R -> E = exp(R-R^T)
        self.raw_R_mat = nn.Parameter(
            0.05 * torch.randn(state_dim, state_dim)
        )

        # eigenvals for diag(\lambda). we need d eigenvals per one basis.
        # (4,d) matrix with each row representing eigenvals for A_i
        self.raw_eigenval_E = nn.Parameter(
            1.0 + 0.1 * torch.randn(num_basis, state_dim)
        )

        # NN for the weights of A.  A_net = (8,4)
        # w = softmax( A_net ( input z vec )),  we need (w_1, .., w_d) for one A_i
        self.A_net = nn.Linear(
            context_dim,
            num_basis
        )

        # net for learnable matrix B = (8,8).
        self.alpha_net = nn.Linear(
            context_dim,
            state_dim,
            bias=False
        )

    """
        Input : transformer input = z = (B,T,D), D = context_dim


    """
    def forward(self, transformer_input: torch.Tensor) -> dict[str,torch.Tensor]:

        # basis A = E^T diag(eigen) E
        # E = exp(R-R^T)
        skew = self.raw_R_mat - self.raw_R_mat.transpose(0,1)
        E = torch.linalg.matrix_exp(skew) # (d,d)

        #eigenvals for diag(eigen). 
        # since, A is PSD. eigen >=0,  A = (B,T,d,d) : one matrix for each (B,T)
        basis_eigen_spec = self.raw_eigenval_E**2

        diag_mat = torch.diag_embed(basis_eigen_spec) # (4,d,d)


        # w = (B,T,4). Should be multiplied with basis A mat.
        weight = torch.softmax(self.A_net(transformer_input), dim=2)

        A_eigen_vals = weight @ basis_eigen_spec  # (B,T,4) @ (4,d) = (B,T,d)

        # using Broadcasting, dont need to expand "common tensor"
        # (d,d) @ (B,T,d,d) @ (d,d) = (B,T,d,d) : broadcasting the last two dim (d,d) for all B,T.
        res_A_mat = (
            E @ torch.diag_embed(A_eigen_vals) @ E.transpose(0,1)
        )
        


        #alpha vector, (B,T,d)
        alpha = self.alpha_net(transformer_input)

        result = {
            "A" :  res_A_mat, #(B,T,d,d)
            "alpha" : alpha , #(B,T,d)
            "eigen_vals" : A_eigen_vals ,  #(B,T,d)
            "mix_weights" : weight, #(B,T,4)
            "E" : E,  #(d,d)
        }

        return result
